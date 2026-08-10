import type { Serializable, SerializableInput } from '../types.js';

interface BrokerManager {
	broadcast<T extends Serializable>(message: SerializableInput<T>, ignore?: number[]): Promise<void>;
}

export class IPCBrokerManager {
	constructor (private readonly manager: BrokerManager) { }

	public listen(): this {
		return this;
	}

	public send<T extends Serializable>(message: SerializableInput<T>, ignore?: number[]): Promise<void> {
		return this.manager.broadcast(message, ignore);
	}
}

export class IPCBrokerClient {
	constructor (private readonly client: { broadcast<T extends Serializable>(message: SerializableInput<T>, sendSelf?: boolean): Promise<void> }) { }

	public listen(): this {
		return this;
	}

	public send<T extends Serializable>(message: SerializableInput<T>, sendSelf = false): Promise<void> {
		return this.client.broadcast(message, sendSelf);
	}
}
