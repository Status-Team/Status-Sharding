import { StoredPromise } from '../types';
import { BaseMessage, DataType } from '../other/message';
export declare class PromiseHandler {
    nonces: Map<string, StoredPromise>;
    resolve(message: BaseMessage<DataType, unknown>): void;
    create<T>(nonce: string, timeout?: number): Promise<T>;
}
