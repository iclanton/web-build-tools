// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as childProcess from 'child_process';

import { ISubprocessMessageBase } from './SubprocessCommunication';

export type SendMessageFnType = (message: ISubprocessMessageBase) => void;

export interface ISubprocessCommunicationManagerBaseOptions {
  sendMessageToParentProcessFn: SendMessageFnType;
  sendMessageToSubprocessFn: SendMessageFnType;
}

export abstract class SubprocessCommunicationManagerBase {
  protected readonly _sendMessageToParentProcessFn: SendMessageFnType;
  protected _sendMessageToSubprocessFn: SendMessageFnType;

  public constructor(options: ISubprocessCommunicationManagerBaseOptions) {
    this._sendMessageToParentProcessFn = options.sendMessageToParentProcessFn;
    this._sendMessageToSubprocessFn = options.sendMessageToSubprocessFn;
  }

  public registerSubprocess(subprocess: childProcess.ChildProcess): void {
    this._sendMessageToSubprocessFn = subprocess.send.bind(subprocess);
  }

  public abstract canHandleMessageFromSubprocess(message: ISubprocessMessageBase): boolean;
  public abstract receiveMessageFromSubprocess(message: ISubprocessMessageBase): void;

  public abstract canHandleMessageFromParentProcess(message: ISubprocessMessageBase): boolean;
  public abstract receiveMessageFromParentProcess(message: ISubprocessMessageBase): void;
}