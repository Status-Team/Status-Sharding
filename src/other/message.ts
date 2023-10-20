import { EvalOptions, MessageTypes, SerializableInput, Serializable } from '../types';
import { ClusterClient } from '../core/clusterClient';
import { Cluster } from '../core/cluster';

export type EvalMessage<P extends object = object> = {
	options?: EvalOptions<P>;
	script: string;
};

export type RespawnMessage = {
	clusterDelay?: number; // Only when respawning all clusters.
	respawnDelay?: number;
	timeout?: number;
};

export type EvalResultMessage = unknown;
export type MaintenanceMessage = string;
export type DataType = 'normal' | 'eval' | 'respawn' | 'maintenance' | 'evalResult' | 'readyOrSpawn' | 'heartbeat' | 'error' | 'reply';

export type DataTypes<A = object, P extends object = object> = {
	normal: A extends never ? Serializable : A;
	reply: DataTypes<A, P>['normal'];
	eval: EvalMessage<P>;
	readyOrSpawn: undefined;
	heartbeat: undefined;
	respawn: RespawnMessage;
	maintenance: MaintenanceMessage;
	evalResult: EvalResultMessage;
	error: {
		message: string;
		stack?: string;
		name: string;
	};
};

export type BaseMessage<D extends DataType, A extends (Serializable | unknown) = Serializable, P extends object = object> = {
	_type: MessageTypes;
	_nonce: string;
	data: DataTypes<A, P>[D];
}

export type BaseMessageInput<D extends DataType, A extends Serializable = Serializable> = Omit<BaseMessage<D, A>, '_nonce'>;

export class ProcessMessage<T extends DataType = 'normal', A extends Serializable = Serializable> {
	private _instance: ClusterClient | Cluster;
	private _nonce: string;
	public data: DataTypes<A, object>[T];

	constructor(instance: ClusterClient | Cluster, data: BaseMessage<T, A>) {
		this.data = data.data;
		this._nonce = data._nonce;
		this._instance = instance;
	}

	public async reply<T extends Serializable>(message: SerializableInput<T>): Promise<void> {
		return this._instance._sendInstance({
			data: message,
			_type: MessageTypes.CustomReply,
			_nonce: this._nonce,
		} as BaseMessage<'reply'>) as Promise<void>;
	}
}
