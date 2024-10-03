import { MessageTypes, Serializable, StoredPromise } from '../types';
import { BaseMessage, DataType } from '../other/message';
import { ClusterManager } from 'src/core/clusterManager';
import { ClusterClient } from 'src/core/clusterClient';

/**
 * Handles promises by storing them in a map and resolving them when the response is received.
 * @export
 * @class PromiseHandler
 * @typedef {PromiseHandler}
 */
export class PromiseHandler {
	/**
	 * List of promises and their unique identifiers.
	 * @type {Map<string, StoredPromise>}
	 */
	nonces: Map<string, StoredPromise> = new Map();

	/**
	 * Creates an instance of PromiseHandler.
	 * @constructor
	 * @param {(ClusterManager | ClusterClient)} instance - The instance of the Promise Handler.
	 */
	constructor(private instance: ClusterManager | ClusterClient) {}

	/**
	 * Resolves the promise with the data received.
	 * @template {DataType} D - The type of the message.
	 * @template {unknown} [A=Serializable] - The type of the message data.
	 * @template {object} [P=object] - The type of the message options.
	 * @param {BaseMessage<D, A, P>} message The message received.
	 * @returns {void} Nothing.
	 */
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

	/**
	 * Creates a promise and stores it in the map.
	 * @async
	 * @template {unknown} T - The return type of the promise.
	 * @param {string} nonce - The unique identifier of the promise.
	 * @param {?number} [timeout] - How long to wait before rejecting the promise.
	 * @returns {Promise<T>} The promise.
	 */
	public async create<T>(nonce: string, timeout?: number): Promise<T> {
		return await new Promise<T>((resolve, reject) => {
			if (!timeout) this.nonces.set(nonce, { resolve, reject });
			else this.nonces.set(nonce, { resolve, reject, timeout: setTimeout(() => { this.nonces.delete(nonce); reject(new Error('Promise timed out.')); }, timeout) });
		});
	}
}
