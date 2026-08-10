import { MessageTypes, type BaseMessage, type DataType, type DataTypes, type Serializable, type SerializableInput } from '../types.js';

export { MessageTypes };
export type { BaseMessage, DataType, DataTypes };

export function isBaseMessage(value: unknown): value is BaseMessage<DataType> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	if (!('_type' in value)) return false;
	const type = value._type;

	if (!Number.isInteger(type) || type === MessageTypes.MissingType) return false;
	if ('_nonce' in value && value._nonce !== undefined && (typeof value._nonce !== 'string' || value._nonce.length > 256)) return false;
	
	return true;
}

interface MessageEndpoint {
	_sendInstance(message: BaseMessage<DataType>): Promise<void>;
}

export class ProcessMessage<D extends DataType = 'normal', Value extends Serializable = Serializable, Context extends object = object> {
	public readonly data: DataTypes<Value, Context>[D] | undefined;

	private readonly nonce?: string;
	private readonly clusterId?: number;
	private readonly generation?: number;

	private readonly replySender: (message: BaseMessage<'reply'>) => Promise<void>;

	constructor (endpoint: MessageEndpoint, message: BaseMessage<D, Value, Context>, replySender?: (message: BaseMessage<'reply'>) => Promise<void>) {
		this.data = message.data;
		this.nonce = message._nonce;
		this.clusterId = message._clusterId;
		this.generation = message._generation;
		this.replySender = replySender ?? ((reply) => endpoint._sendInstance(reply));
	}

	public reply<Result extends Serializable>(message: SerializableInput<Result>): Promise<void> {
		if (!this.nonce) return Promise.reject(new Error('CLUSTERING_REPLY_NONCE_MISSING | This message has no reply nonce.'));

		return this.replySender({
			_type: MessageTypes.CustomReply,
			_nonce: this.nonce,
			_clusterId: this.clusterId,
			_generation: this.generation,
			data: message,
		});
	}
}
