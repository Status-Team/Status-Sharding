import { MessageTypes, StoredPromise } from '../types';
import { BaseMessage, DataType } from '../other/message';

export class PromiseHandler {
	nonces: Map<string, StoredPromise> = new Map();

	public resolve(message: BaseMessage<DataType, unknown>) {
		const promise = this.nonces.get(message._nonce);
		if (!promise) throw new Error(`No promise found with nonce ${message._nonce}.`);

		if (promise.timeout) clearTimeout(promise.timeout);
		this.nonces.delete(message._nonce);

		if (message._type !== MessageTypes.ClientEvalResponseError) promise.resolve(message.data);
		else {
			const error = new Error((message.data as BaseMessage<'error'>['data']).message);

			error.stack = (message.data as BaseMessage<'error'>['data']).stack;
			error.name = (message.data as BaseMessage<'error'>['data']).name;
			promise.reject(error);
		}
	}

	public async create<T>(nonce: string, timeout?: number): Promise<T> {
		return await new Promise<T>((resolve, reject) => {
			if (!timeout) this.nonces.set(nonce, { resolve, reject });
			else this.nonces.set(nonce, { resolve, reject, timeout: setTimeout(() => { this.nonces.delete(nonce); reject(new Error('Promise timed out.')); }, timeout) });
		});
	}
}
