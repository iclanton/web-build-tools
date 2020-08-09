// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { IHeftPlugin } from '../IHeftPlugin';
import { ScopedLogger } from './ScopedLogger';
import { ITerminalProvider } from '@rushstack/node-core-library';

export interface ILoggingManagerOptions {
  terminalProvider: ITerminalProvider;
}

export class LoggingManager {
  private _options: ILoggingManagerOptions;
  private _scopedLoggers: Map<string, ScopedLogger> = new Map<string, ScopedLogger>();
  private _shouldPrintStacks: boolean;

  public constructor(options: ILoggingManagerOptions) {
    this._options = options;
  }

  public enablePrintStacks(): void {
    this._shouldPrintStacks = true;
  }

  public requestScopedLogger(plugin: IHeftPlugin, loggerName: string): ScopedLogger {
    const existingScopedLogger: ScopedLogger | undefined = this._scopedLoggers.get(loggerName);
    if (existingScopedLogger) {
      throw new Error(
        `A named logger with name "${loggerName}" has already been requested ` +
          `by plugin "${existingScopedLogger._requestingPlugin.displayName}".`
      );
    } else {
      const scopedLogger: ScopedLogger = new ScopedLogger({
        requestingPlugin: plugin,
        loggerName,
        terminalProvider: this._options.terminalProvider,
        getShouldPrintStacks: () => this._shouldPrintStacks
      });
      this._scopedLoggers.set(loggerName, scopedLogger);
      return scopedLogger;
    }
  }

  public getErrorStrings(): string[] {
    const result: string[] = [];

    for (const [, scopedLogger] of this._scopedLoggers) {
      result.push(...scopedLogger.errors.map((error) => `[${scopedLogger.loggerName}] ${error.message}`));
    }

    return result;
  }

  public getWarningStrings(): string[] {
    const result: string[] = [];

    for (const [, scopedLogger] of this._scopedLoggers) {
      result.push(
        ...scopedLogger.warnings.map((warning) => `[${scopedLogger.loggerName}] ${warning.message}`)
      );
    }

    return result;
  }
}