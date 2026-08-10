import type { BaseMessage, DataType } from '../other/message.js';
import { isBaseMessage } from '../other/message.js';

export class MessageHandler {
	constructor (private readonly route: (message: BaseMessage<DataType>) => Promise<void>) { }

	public handle(message: unknown): Promise<void> {
		if (!isBaseMessage(message)) return Promise.resolve();

		return this.route(message);
	}
}

export class ClusterHandler extends MessageHandler { }
export class ClusterClientHandler extends MessageHandler { }
