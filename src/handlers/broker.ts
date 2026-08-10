import type { Serializable, SerializableInput } from '../types.js';

export type BrokerMessage = { _data: Serializable; broker: string };
export type BrokerMessageHandler = (message: Serializable) => void;

abstract class IPCBrokerAbstract {
	private readonly listeners = new Map<string, BrokerMessageHandler[]>();

	constructor (private readonly debug: (message: string) => void) { }

	public listen(channelName: string, callback: BrokerMessageHandler): void {
		if (!channelName.length) throw new Error('BROKER_CHANNEL_INVALID | A broker channel name is required.');

		const listeners = this.listeners.get(channelName) ?? [];
		listeners.push(callback);
		this.listeners.set(channelName, listeners);
	}

	public _receive(channelName: string, message: Serializable): void {
		const listeners = this.listeners.get(channelName);
		if (!listeners) return;

		for (const listener of listeners) {
			try {
				listener(message);
			} catch (error: unknown) {
				this.debug(`A broker listener on channel ${channelName} failed with ${error instanceof Error ? error.message : String(error)}.`);
			}
		}
	}
}

export class IPCBrokerManager extends IPCBrokerAbstract {
	constructor (private readonly sendToClusters: <T extends Serializable>(channelName: string, message: SerializableInput<T>, clusterId?: number) => Promise<void>, debug: (message: string) => void) {
		super(debug);
	}

	public send<T extends Serializable>(channelName: string, message: SerializableInput<T>, clusterId?: number): Promise<void> {
		return this.sendToClusters(channelName, message, clusterId);
	}
}

export class IPCBrokerClient extends IPCBrokerAbstract {
	constructor (private readonly sendToManager: <T extends Serializable>(channelName: string, message: SerializableInput<T>) => Promise<void>, debug: (message: string) => void) {
		super(debug);
	}

	public send<T extends Serializable>(channelName: string, message: SerializableInput<T>): Promise<void> {
		return this.sendToManager(channelName, message);
	}
}
