// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

/**
 * A Heft plugin for integration with the Backfill tool.
 * @packageDocumentation
 */

import { HeftConfiguration, HeftSession, IHeftPlugin } from '@rushstack/heft';

const PLUGIN_NAME: string = 'backfill-plugin';

/**
 * @public
 */
export class BackfillPlugin implements IHeftPlugin {
  public readonly pluginName: string = PLUGIN_NAME;

  public apply(heftSession: HeftSession, heftConfiguration: HeftConfiguration): void {
    throw new Error('Method not implemented.');
  }
}
