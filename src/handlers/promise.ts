import { MessageTypes, Serializable, StoredPromise } from '../types';
import { BaseMessage, DataType } from '../other/message';
import { ClusterManager } from '../core/clusterManager';
import { ClusterClient } from '../core/clusterClient';

/** Handles promises by storing them in a map and resolving them when the response is received. */
export class PromiseHandler {
	/** List of promises and their unique identifiers. */
	nonces: Map<string, StoredPromise> = new Map();

	/** Creates an instance of PromiseHandler. */
	constructor(private instance: ClusterManager | ClusterClient) {}

	/** Resolves the promise with the data received. */
	public resolve<D extends DataType, A = Serializable, P extends object = object>(message: BaseMessage<D, A, P>): void {
		const promise = this.nonces.get(message._nonce);
		if (!promise) return this.instance._debug(`Received a message with an unknown nonce: ${message._nonce}`);

		if (promise.timeout) clearTimeout(promise.timeout);
		this.nonces.delete(message._nonce);

		if (message._type !== MessageTypes.ClientEvalResponseError) promise.resolve(message.data);
		else {
			const data = message.data as BaseMessage<'error'>['data'];
			const error = new Error(data.message + '\n' + data.stack);

			error.cause = data.script;
			error.stack = data.stack;
			error.name = data.name;
			promise.reject(error);

			console.error('An error occurred while evaluating the script:', data);
		}
	}

	/** Creates a promise and stores it in the map. */
	public async create<T>(nonce: string, timeout?: number): Promise<T> {
		return await new Promise<T>((resolve, reject) => {
			if (!timeout) this.nonces.set(nonce, { resolve, reject });
			else this.nonces.set(nonce, { resolve, reject, timeout: setTimeout(() => { this.nonces.delete(nonce); reject(new Error('Promise timed out.')); }, timeout) });
		});
	}
}
