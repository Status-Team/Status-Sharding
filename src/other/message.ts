import { EvalOptions, MessageTypes, SerializableInput, Serializable } from '../types';
import { ClusterClient } from '../core/clusterClient';
import { Cluster } from '../core/cluster';

/**
 * Eval message type.
 * @export
 * @typedef {EvalMessage}
 * @template {object} [P=object] - The type of the message options.
 */
export type EvalMessage<P extends object = object> = {
	options?: EvalOptions<P>;
	script: string;
};

/**
 * Respawn message type.
 * @export
 * @typedef {RespawnMessage}
 */
export type RespawnMessage = {
	clusterDelay?: number; // Only when respawning all clusters.
	respawnDelay?: number;
	timeout?: number;
	except?: number[];
};

/**
 * Respawn some message type.
 * @export
 * @typedef {RespawnSomeMessage}
 */
export type RespawnSomeMessage = {
	clusterIds: number[];
	clusterDelay?: number; // Only when respawning all clusters.
	respawnDelay?: number;
	timeout?: number;
};

/**
 * Result of an eval message.
 * @export
 * @typedef {EvalResultMessage}
 */
export type EvalResultMessage = unknown;
/**
 * The type of the maintenace message.
 * @export
 * @typedef {MaintenanceMessage}
 */
export type MaintenanceMessage = string;
/**
 * The type of the maintenance message.
 * @export
 * @typedef {DataType}
 */
export type DataType = 'normal' | 'eval' | 'respawnAll' | 'maintenance' | 'evalResult' | 'readyOrSpawn' | 'heartbeat' | 'error' | 'reply' | 'respawnSome';

/**
 * The type of the message.
 * @export
 * @typedef {DataTypes}
 * @template {unknown} [A=object] - The type of the message data.
 * @template {object} [P=object] - The type of the message options.
 */
export type DataTypes<A = object, P extends object = object> = {
	normal: A extends never ? Serializable : A;
	reply: DataTypes<A, P>['normal'];
	eval: EvalMessage<P>;
	readyOrSpawn: undefined;
	heartbeat: undefined;
	respawnAll: RespawnMessage;
	respawnSome: RespawnSomeMessage;
	maintenance: MaintenanceMessage;
	evalResult: EvalResultMessage;
	error: {
		message: string;
		script: string;
		stack?: string;
		name: string;
	};
};

/**
 * Base message for IPC communication.
 * @export
 * @typedef {BaseMessage}
 * @template {DataType} D - The type of the message.
 * @template {unknown} [A=Serializable] - The type of the message data.
 * @template {object} [P=object] - The type of the message options.
 */
export type BaseMessage<D extends DataType, A = Serializable, P extends object = object> = {
	_type: MessageTypes;
	_nonce: string;
	data: DataTypes<A, P>[D];
}

/**
 * Serializable input.
 * @export
 * @typedef {BaseMessageInput}
 * @template {DataType} D - The type of the message.
 * @template {Serializable} [A=Serializable] - The type of the message data.
 */
export type BaseMessageInput<D extends DataType, A extends Serializable = Serializable> = Omit<BaseMessage<D, A>, '_nonce'>;

/**
 * Message that is sent on IPC.
 * @export
 * @class ProcessMessage
 * @typedef {ProcessMessage}
 * @template {DataType} [D='normal'] - The type of the message.
 * @template {Serializable} [A=Serializable] - The type of the message data.
 * @template {object} [P=object] - The type of the message options.
 */
export class ProcessMessage<D extends DataType = 'normal', A extends Serializable = Serializable, P extends object = object> {
	/**
	 * Instance of the cluster client or cluster.
	 * @private
	 * @type {(ClusterClient | Cluster)}
	 */
	private _instance: ClusterClient | Cluster;
	/**
	 * The nonce of the message.
	 * @private
	 * @type {string}
	 */
	private _nonce: string;
	/**
	 * The data of the message.
	 * @type {DataTypes<A, object>[D]}
	 */
	public data: DataTypes<A, object>[D];

	/**
	 * Creates an instance of ProcessMessage.
	 * @constructor
	 * @param {(ClusterClient | Cluster)} instance - The instance of the cluster client or cluster.
	 * @param {BaseMessage<D, A, P>} data - The data of the message.
	 */
	constructor(instance: ClusterClient | Cluster, data: BaseMessage<D, A, P>) {
		this.data = data.data;
		this._nonce = data._nonce;
		this._instance = instance;
	}

	/**
	 * Replies to the message.
	 * @async
	 * @template {Serializable} T - The type of the message.
	 * @param {SerializableInput<T>} message - The message to send.
	 * @returns {Promise<void>} The promise.
	 */
	public async reply<T extends Serializable>(message: SerializableInput<T>): Promise<void> {
		return this._instance._sendInstance({
			data: message,
			_type: MessageTypes.CustomReply,
			_nonce: this._nonce,
		} as BaseMessage<'reply'>) as Promise<void>;
	}
}
