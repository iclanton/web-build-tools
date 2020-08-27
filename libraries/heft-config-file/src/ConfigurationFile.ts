// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as nodeJsPath from 'path';
import { JSONPath } from 'jsonpath-plus';
import { JsonSchema, JsonFile, PackageJsonLookup, Import, FileSystem } from '@rushstack/node-core-library';

interface IConfigurationJson {
  extends?: string;
}

/**
 * @beta
 */
export enum InheritanceType {
  /**
   * Append additional elements after elements from the parent file's property
   */
  append = 'append',

  /**
   * Discard elements from the parent file's property
   */
  replace = 'replace'
}

/**
 * @beta
 */
export enum PathResolutionMethod {
  /**
   * Resolve a path relative to the configuration file
   */
  resolvePathRelativeToConfigurationFile,

  /**
   * Resolve a path relative to the root of the project containing the configuration file
   */
  resolvePathRelativeToProjectRoot,

  /**
   * Treat the property as a NodeJS-style require/import reference and resolve using standard
   * NodeJS filesystem resolution
   */
  NodeResolve
}

const CONFIGURATION_FILE_FIELD_ANNOTATION: unique symbol = Symbol('configuration-file-field-annotation');

interface IAnnotatedField<TField> {
  [CONFIGURATION_FILE_FIELD_ANNOTATION]: IConfigurationFileFieldAnnotation<TField>;
}

interface IConfigurationFileFieldAnnotation<TField> {
  configurationFilePath: string | undefined;
  originalValues: { [propertyName in keyof TField]: unknown };
}

interface IConfigurationFileCacheEntry<TConfigurationFile> {
  configurationFile?: TConfigurationFile;
  error?: Error;
}

/**
 * @beta
 */
export interface IJsonPathMetadataToken {
  /**
   * The token name. Must only contain alphanumeric characters
   */
  token: string;

  /**
   * The value that the token will be replaced with
   */
  tokenValue: string;
}

/**
 * Used to specify how node(s) in a JSON object should be processed after being loaded.
 *
 * @beta
 */
export interface IJsonPathMetadata {
  pathResolutionMethod?: PathResolutionMethod;
  tokens?: IJsonPathMetadataToken[];
}

/**
 * @beta
 */
export type IPropertyInheritanceTypes<TConfigurationFile> = {
  [propertyName in keyof TConfigurationFile]?: InheritanceType;
};

/**
 * Keys in this object are JSONPaths {@link https://jsonpath.com/}, and values are objects
 * that describe how node(s) selected by the JSONPath are processed after loading.
 *
 * @beta
 */
export interface IJsonPathsMetadata {
  [jsonPath: string]: IJsonPathMetadata;
}

/**
 * @beta
 */
export interface IConfigurationFileOptions<TConfigurationFile> {
  /**
   * Use this property to specify how JSON nodes are postprocessed.
   */
  jsonPathMetadata?: IJsonPathsMetadata;

  /**
   * Use this property to control how root-level properties are handled between parent and child
   * configuration files.
   */
  propertyInheritanceTypes?: IPropertyInheritanceTypes<TConfigurationFile>;
}

interface IJsonPathCallbackObject {
  path: string;
  parent: object;
  parentProperty: string;
  value: string;
}

/**
 * @beta
 */
export interface IOriginalValueOptions<TParentProperty> {
  parentObject: TParentProperty;
  propertyName: keyof TParentProperty;
}

type JsonPathProcessor = (originalValue: string, configurationFilePath: string) => string;

/**
 * @beta
 */
export class ConfigurationFile<TConfigurationFile> {
  private readonly _schema: JsonSchema;
  private readonly _jsonPathMetadata: Map<string, JsonPathProcessor>;
  private readonly _propertyInheritanceTypes: IPropertyInheritanceTypes<TConfigurationFile>;

  private readonly _configurationFileCache: Map<
    string,
    IConfigurationFileCacheEntry<TConfigurationFile>
  > = new Map<string, IConfigurationFileCacheEntry<TConfigurationFile>>();
  private readonly _packageJsonLookup: PackageJsonLookup = new PackageJsonLookup();

  public constructor(jsonSchemaPath: string, options?: IConfigurationFileOptions<TConfigurationFile>);
  public constructor(jsonSchema: JsonSchema, options?: IConfigurationFileOptions<TConfigurationFile>);
  public constructor(
    jsonSchema: string | JsonSchema,
    options?: IConfigurationFileOptions<TConfigurationFile>
  ) {
    if (typeof jsonSchema === 'string') {
      jsonSchema = JsonSchema.fromFile(jsonSchema);
    }

    this._schema = jsonSchema;
    this._propertyInheritanceTypes = options?.propertyInheritanceTypes || {};

    this._jsonPathMetadata = new Map<string, JsonPathProcessor>();
    for (const [jsonPath, metadata] of Object.entries(options?.jsonPathMetadata || {})) {
      const replacers: Map<RegExp, string> = new Map<RegExp, string>();
      const pathResolutionMethod: PathResolutionMethod | undefined = metadata.pathResolutionMethod;

      if (metadata.tokens?.length) {
        const existingTokens: Set<string> = new Set<string>();
        for (const { token, tokenValue } of metadata.tokens) {
          if (!token.match(/^[A-z0-9]+$/)) {
            throw new Error(
              `Token "${token}" in metadata for jsonPath "${jsonPath}" must only contain alphanumeric characters.`
            );
          }

          if (existingTokens.has(token)) {
            throw new Error(
              `Token "${token}" in appears multiple times in metadata for jsonPath "${jsonPath}".`
            );
          }

          existingTokens.add(token);

          replacers.set(new RegExp(`\\<${token}\\>`, 'g'), tokenValue);
        }
      }

      if (replacers.size > 0 || pathResolutionMethod !== undefined) {
        this._jsonPathMetadata.set(jsonPath, (originalValue: string, configurationFilePath: string) => {
          for (const [tokenRegex, tokenValue] of replacers.entries()) {
            originalValue = originalValue.replace(tokenRegex, tokenValue);
          }

          return this._resolvePathProperty(configurationFilePath, originalValue, pathResolutionMethod);
        });
      }
    }
  }

  public async loadConfigurationFileAsync(configurationFilePath: string): Promise<TConfigurationFile> {
    return await this._loadConfigurationFileInnerAsync(
      nodeJsPath.resolve(configurationFilePath),
      new Set<string>()
    );
  }

  /**
   * @internal
   */
  public static _formatPathForError: (path: string) => string = (path: string) => path;

  /**
   * Get the path to the source file that the referenced property was originally
   * loaded from.
   */
  public getObjectSourceFilePath<TObject extends object>(obj: TObject): string | undefined {
    const annotation: IConfigurationFileFieldAnnotation<TObject> | undefined =
      obj[CONFIGURATION_FILE_FIELD_ANNOTATION];
    if (annotation) {
      return annotation.configurationFilePath;
    }

    return undefined;
  }

  /**
   * Get the value of the specified property on the specified object that was originally
   * loaded from a configuration file.
   */
  public getPropertyOriginalValue<TParentProperty extends object, TValue>(
    options: IOriginalValueOptions<TParentProperty>
  ): TValue {
    const annotation: IConfigurationFileFieldAnnotation<TParentProperty> | undefined =
      options.parentObject[CONFIGURATION_FILE_FIELD_ANNOTATION];
    if (annotation && annotation.originalValues.hasOwnProperty(options.propertyName)) {
      return annotation.originalValues[options.propertyName] as TValue;
    }

    throw new Error(`No original value could be determined for property "${options.propertyName}"`);
  }

  private async _loadConfigurationFileInnerAsync(
    resolvedConfigurationFilePath: string,
    visitedConfigurationFilePaths: Set<string>
  ): Promise<TConfigurationFile> {
    let cacheEntry:
      | IConfigurationFileCacheEntry<TConfigurationFile>
      | undefined = this._configurationFileCache.get(resolvedConfigurationFilePath);
    if (!cacheEntry) {
      try {
        const resolvedConfigurationFilePathForErrors: string = ConfigurationFile._formatPathForError(
          resolvedConfigurationFilePath
        );

        if (visitedConfigurationFilePaths.has(resolvedConfigurationFilePath)) {
          throw new Error(
            'A loop has been detected in the "extends" properties of configuration file at ' +
              `"${resolvedConfigurationFilePathForErrors}".`
          );
        }

        visitedConfigurationFilePaths.add(resolvedConfigurationFilePath);

        let fileText: string;
        try {
          fileText = await FileSystem.readFileAsync(resolvedConfigurationFilePath);
        } catch (e) {
          if (FileSystem.isNotExistError(e)) {
            e.message = `File does not exist: ${resolvedConfigurationFilePathForErrors}`;
          }

          throw e;
        }

        let configurationJson: IConfigurationJson & TConfigurationFile;
        try {
          configurationJson = await JsonFile.parseString(fileText);
        } catch (e) {
          throw new Error(`In config file "${resolvedConfigurationFilePathForErrors}": ${e}`);
        }

        this._schema.validateObject(configurationJson, resolvedConfigurationFilePathForErrors);

        this._annotateProperties(resolvedConfigurationFilePath, configurationJson);

        for (const [jsonPath, processorFunction] of this._jsonPathMetadata.entries()) {
          JSONPath({
            path: jsonPath,
            json: configurationJson,
            callback: (payload: unknown, payloadType: string, fullPayload: IJsonPathCallbackObject) => {
              fullPayload.parent[fullPayload.parentProperty] = processorFunction(
                fullPayload.value,
                resolvedConfigurationFilePath
              );
            },
            otherTypeCallback: () => {
              throw new Error('@other() tags are not supported');
            }
          });
        }

        let parentConfiguration: Partial<TConfigurationFile> = {};
        if (configurationJson.extends) {
          const resolvedParentConfigPath: string = nodeJsPath.resolve(
            nodeJsPath.dirname(resolvedConfigurationFilePath),
            configurationJson.extends
          );
          parentConfiguration = await this._loadConfigurationFileInnerAsync(
            resolvedParentConfigPath,
            visitedConfigurationFilePaths
          );
        }

        const propertyNames: Set<string> = new Set<string>([
          ...Object.keys(parentConfiguration),
          ...Object.keys(configurationJson)
        ]);

        const resultAnnotation: IConfigurationFileFieldAnnotation<TConfigurationFile> = {
          configurationFilePath: resolvedConfigurationFilePath,
          originalValues: {} as TConfigurationFile
        };
        const result: TConfigurationFile = ({
          [CONFIGURATION_FILE_FIELD_ANNOTATION]: resultAnnotation
        } as unknown) as TConfigurationFile;
        for (const propertyName of propertyNames) {
          if (propertyName === '$schema' || propertyName === 'extends') {
            continue;
          }

          const propertyValue: unknown | undefined = configurationJson[propertyName];
          const parentPropertyValue: unknown | undefined = parentConfiguration[propertyName];

          const bothAreArrays: boolean = Array.isArray(propertyValue) && Array.isArray(parentPropertyValue);
          const defaultInheritanceType: InheritanceType = bothAreArrays
            ? InheritanceType.append
            : InheritanceType.replace;
          const inheritanceType: InheritanceType =
            this._propertyInheritanceTypes[propertyName] !== undefined
              ? this._propertyInheritanceTypes[propertyName]
              : defaultInheritanceType;

          let newValue: unknown;
          const usePropertyValue: () => void = () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            resultAnnotation.originalValues[propertyName] = this.getPropertyOriginalValue<any, any>({
              parentObject: configurationJson,
              propertyName: propertyName
            });
            newValue = propertyValue;
          };
          const useParentPropertyValue: () => void = () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            resultAnnotation.originalValues[propertyName] = this.getPropertyOriginalValue<any, any>({
              parentObject: parentConfiguration,
              propertyName: propertyName
            });
            newValue = parentPropertyValue;
          };

          switch (inheritanceType) {
            case InheritanceType.replace: {
              if (propertyValue !== undefined) {
                usePropertyValue();
              } else {
                useParentPropertyValue();
              }

              break;
            }

            case InheritanceType.append: {
              if (propertyValue !== undefined && parentPropertyValue === undefined) {
                usePropertyValue();
              } else if (propertyValue === undefined && parentPropertyValue !== undefined) {
                useParentPropertyValue();
              } else {
                if (!Array.isArray(propertyValue) || !Array.isArray(parentPropertyValue)) {
                  throw new Error(
                    `Issue in processing configuration file property "${propertyName}". ` +
                      `Property is not an array, but the inheritance type is set as "${InheritanceType.append}"`
                  );
                }

                newValue = [...parentPropertyValue, ...propertyValue];
                ((newValue as unknown) as IAnnotatedField<unknown[]>)[CONFIGURATION_FILE_FIELD_ANNOTATION] = {
                  configurationFilePath: undefined,
                  originalValues: {
                    ...parentPropertyValue[CONFIGURATION_FILE_FIELD_ANNOTATION].originalValues,
                    ...propertyValue[CONFIGURATION_FILE_FIELD_ANNOTATION].originalValues
                  }
                };
              }

              break;
            }

            default: {
              throw new Error(`Unknown inheritance type "${inheritanceType}"`);
            }
          }

          result[propertyName] = newValue;
        }

        try {
          this._schema.validateObject(result, resolvedConfigurationFilePathForErrors);
        } catch (e) {
          throw new Error(`Resolved configuration object does not match schema: ${e}`);
        }

        cacheEntry = { configurationFile: result };
      } catch (e) {
        cacheEntry = { error: e };
      }
    }

    if (cacheEntry.error) {
      throw cacheEntry.error;
    } else {
      return cacheEntry.configurationFile! as TConfigurationFile;
    }
  }

  private _annotateProperties<TObject>(resolvedConfigurationFilePath: string, obj: TObject): void {
    if (!obj) {
      return;
    }

    if (typeof obj === 'object') {
      this._annotateProperty(resolvedConfigurationFilePath, obj);

      for (const objValue of Object.values(obj)) {
        this._annotateProperties(resolvedConfigurationFilePath, objValue);
      }
    }
  }

  private _annotateProperty<TObject>(resolvedConfigurationFilePath: string, obj: TObject): void {
    if (!obj) {
      return;
    }

    if (typeof obj === 'object') {
      ((obj as unknown) as IAnnotatedField<TObject>)[CONFIGURATION_FILE_FIELD_ANNOTATION] = {
        configurationFilePath: resolvedConfigurationFilePath,
        originalValues: { ...obj }
      };
    }
  }

  private _resolvePathProperty(
    configurationFilePath: string,
    propertyValue: string,
    resolutionMethod: PathResolutionMethod | undefined
  ): string {
    switch (resolutionMethod) {
      case PathResolutionMethod.resolvePathRelativeToConfigurationFile: {
        return nodeJsPath.resolve(nodeJsPath.dirname(configurationFilePath), propertyValue);
      }

      case PathResolutionMethod.resolvePathRelativeToProjectRoot: {
        const packageRoot: string | undefined = this._packageJsonLookup.tryGetPackageFolderFor(
          configurationFilePath
        );
        if (!packageRoot) {
          throw new Error(
            `Could not find a package root for path "${ConfigurationFile._formatPathForError(
              configurationFilePath
            )}"`
          );
        }

        return nodeJsPath.resolve(packageRoot, propertyValue);
      }

      case PathResolutionMethod.NodeResolve: {
        return Import.resolveModule({
          modulePath: propertyValue,
          baseFolderPath: nodeJsPath.dirname(configurationFilePath)
        });
      }

      default: {
        return propertyValue;
      }
    }
  }
}
