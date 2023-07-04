import { ClusterClient } from '../core/clusterClient';
import { EvalOptions, MessageTypes } from '../types';
import { Serializable } from 'child_process';
import { Cluster } from '../core/cluster';

export type EvalMessage<P = object> = {
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

export type DataTypes<A = object> = {
	normal: A extends never ? Serializable : A;
	reply: DataTypes<A>['normal'];
	eval: EvalMessage<A>;
	readyOrSpawn: undefined;
	heartbeat: undefined;
	respawn: RespawnMessage;
	maintenance: MaintenanceMessage;
	evalResult: unknown;
	error: {
		message: string;
		stack?: string;
		name: string;
	};
};

export interface BaseMessage<D extends DataType, A extends (Serializable | unknown) = Serializable> {
	_type: MessageTypes;
	_nonce: string;
	data: DataTypes<A>[D];
}

export class ProcessMessage<T extends DataType = 'normal', A extends Serializable = Serializable> {
	private _instance: ClusterClient | Cluster;
	private _nonce: string;
	public data: DataTypes<A>[T];

	constructor(instance: ClusterClient | Cluster, data: BaseMessage<T, A>) {
		this.data = data.data;
		this._nonce = data._nonce;
		this._instance = instance;
	}

	public send(message: Serializable) {
		return this._instance.send(message);
	}

	public async reply(message: Serializable): Promise<void> {
		return this._instance._sendInstance({
			data: message,
			_type: MessageTypes.CustomReply,
			_nonce: this._nonce,
		} as BaseMessage<'reply'>) as Promise<void>;
	}
}
