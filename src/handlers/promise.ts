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

		const errorTypes = [
			MessageTypes.ClientEvalResponseError,
			MessageTypes.ClientManagerEvalResponseError,
			MessageTypes.ClientBroadcastResponseError,
		];

		if (!errorTypes.includes(message._type)) {
			promise.resolve(message.data);
			return;
		}

		const data = message.data as Partial<BaseMessage<'error'>['data']>;
		const error = new Error([data.message, data.stack].filter(Boolean).join('\n') || 'Unknown IPC error');

		if (data.script) error.cause = data.script;
		if (data.stack) error.stack = data.stack;
		if (data.name) error.name = data.name;

		promise.reject(error);

		console.error('An error occurred while resolving an IPC promise:', data);
	}

	/** Rejects a stored promise when its IPC message could not be sent. */
	public reject(nonce: string, error: Error): void {
		const promise = this.nonces.get(nonce);
		if (!promise) return this.instance._debug(`Failed to reject an unknown IPC nonce: ${nonce}`);

		if (promise.timeout) clearTimeout(promise.timeout);
		this.nonces.delete(nonce);
		promise.reject(error);
	}

	/** Creates a promise and stores it in the map. */
	public async create<T>(nonce: string, timeout?: number): Promise<T> {
		return await new Promise<T>((resolve, reject) => {
			if (timeout === undefined || timeout < 0) this.nonces.set(nonce, { resolve, reject });
			else this.nonces.set(nonce, {
				resolve, reject,
				timeout: setTimeout(() => {
					this.nonces.delete(nonce);
					reject(new Error('Promise timed out.'));
				}, timeout) as NodeJS.Timeout,
			});
		});
	}
}
