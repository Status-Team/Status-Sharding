export default class CustomMap<K, V> extends Map<K, V> {
	public update(key: K, update: (value?: V) => V): this {
		return this.set(key, update(this.get(key)));
	}

	public map<T>(callback: (value: V, key: K, map: this) => T): T[] {
		const values: T[] = [];
		for (const [key, value] of this) values.push(callback(value, key, this));
		return values;
	}

	public filter(callback: (value: V, key: K, map: this) => boolean): V[] {
		const values: V[] = [];
		for (const [key, value] of this) if (callback(value, key, this)) values.push(value);
		return values;
	}

	public find(callback: (value: V, key: K, map: this) => boolean): V | undefined {
		for (const [key, value] of this) if (callback(value, key, this)) return value;
		return undefined;
	}

	public every(callback: (value: V, key: K, map: this) => boolean): boolean {
		for (const [key, value] of this) if (!callback(value, key, this)) return false;
		return true;
	}
}

export class ClusterMap<K, V> extends CustomMap<K, V> {
	private internalMutation = false;

	public override set(key: K, value: V): this {
		if (!this.internalMutation) throw new Error('CLUSTER_COLLECTION_READ_ONLY | Cluster collections are managed by ClusterManager.');
		return super.set(key, value);
	}

	public override delete(key: K): boolean {
		if (!this.internalMutation) throw new Error('CLUSTER_COLLECTION_READ_ONLY | Cluster collections are managed by ClusterManager.');
		return super.delete(key);
	}

	public override clear(): void {
		if (!this.internalMutation) throw new Error('CLUSTER_COLLECTION_READ_ONLY | Cluster collections are managed by ClusterManager.');
		super.clear();
	}

	public _setInternal(key: K, value: V): this {
		this.internalMutation = true;

		try {
			return super.set(key, value);
		} finally {
			this.internalMutation = false;
		}
	}

	public _deleteInternal(key: K): boolean {
		this.internalMutation = true;

		try {
			return super.delete(key);
		} finally {
			this.internalMutation = false;
		}
	}

	public _clearInternal(): void {
		this.internalMutation = true;

		try {
			super.clear();
		} finally {
			this.internalMutation = false;
		}
	}
}
