// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { SubprocessCommunicationManagerBase } from '../../utilities/subprocess/SubprocessCommunicationManagerBase';
import { ISubprocessMessageBase } from '../../utilities/subprocess/SubprocessCommunication';

const EMIT_COMPLETED_CALLBACK_MANAGER_MESSAGE: string = 'emitCompletedCallbackManagerMessage';

export class EmitCompletedCallbackManager extends SubprocessCommunicationManagerBase {
  private readonly _callback: () => void;

  public constructor(callback: () => void) {
    super();

    this._callback = callback;
  }

  public callback(): void {
    this.sendMessageToParentProcess({ type: EMIT_COMPLETED_CALLBACK_MANAGER_MESSAGE });
  }

  public canHandleMessageFromSubprocess(message: ISubprocessMessageBase): boolean {
    return message.type === EMIT_COMPLETED_CALLBACK_MANAGER_MESSAGE;
  }

  public receiveMessageFromSubprocess(message: ISubprocessMessageBase): void {
    if (message.type === EMIT_COMPLETED_CALLBACK_MANAGER_MESSAGE) {
      this._callback();
    }
  }

  public canHandleMessageFromParentProcess(message: ISubprocessMessageBase): boolean {
    return false;
  }

  public receiveMessageFromParentProcess(message: ISubprocessMessageBase): void {}
}
