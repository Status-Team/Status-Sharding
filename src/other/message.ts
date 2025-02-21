import { EvalOptions, MessageTypes, SerializableInput, Serializable } from '../types';
import { ClusterClient } from '../core/clusterClient';
import { Cluster } from '../core/cluster';

/** Eval message type. */
export type EvalMessage<P extends object = object> = {
	options?: EvalOptions<P>;
	script: string;
};

/** Respawn message type. */
export type RespawnMessage = {
	clusterDelay?: number; // Only when respawning all clusters.
	respawnDelay?: number;
	timeout?: number;
	except?: number[];
};

/** Respawn some message type. */
export type RespawnSomeMessage = {
	clusterIds: number[];
	clusterDelay?: number; // Only when respawning all clusters.
	respawnDelay?: number;
	timeout?: number;
};

/** Result of an eval message. */
export type EvalResultMessage = unknown;
/** The type of the message. */
export type DataType = 'normal' | 'eval' | 'respawnAll' | 'evalResult' | 'readyOrSpawn' | 'heartbeat' | 'error' | 'reply' | 'respawnSome';

/** The type of the message. */
export type DataTypes<A = object, P extends object = object> = {
	normal: A extends never ? Serializable : A;
	reply: DataTypes<A, P>['normal'];
	eval: EvalMessage<P>;
	readyOrSpawn: undefined;
	heartbeat: undefined;
	respawnAll: RespawnMessage;
	respawnSome: RespawnSomeMessage;
	evalResult: EvalResultMessage;
	error: {
		message: string;
		script: string;
		stack?: string;
		name: string;
	};
};

/** Base message for IPC communication. */
export type BaseMessage<D extends DataType, A = Serializable, P extends object = object> = {
	_type: MessageTypes;
	_nonce: string;
	data: DataTypes<A, P>[D];
}

/** Serializable input. */
export type BaseMessageInput<D extends DataType, A extends Serializable = Serializable> = Omit<BaseMessage<D, A>, '_nonce'>;

/** Message that is sent on IPC. */
export class ProcessMessage<D extends DataType = 'normal', A extends Serializable = Serializable, P extends object = object> {
	/** Instance of the cluster client or cluster. */
	private _instance: ClusterClient | Cluster;
	/** The nonce of the message. */
	private _nonce: string;
	/** The data of the message. */
	public data: DataTypes<A, object>[D];

	/** Creates an instance of ProcessMessage. */
	constructor (instance: ClusterClient | Cluster, data: BaseMessage<D, A, P>) {
		this.data = data.data;
		this._nonce = data._nonce;
		this._instance = instance;
	}

	/** Replies to the message. */
	public async reply<T extends Serializable>(message: SerializableInput<T>): Promise<void> {
		return this._instance._sendInstance({
			data: message,
			_type: MessageTypes.CustomReply,
			_nonce: this._nonce,
		} as BaseMessage<'reply'>) as Promise<void>;
	}
}
