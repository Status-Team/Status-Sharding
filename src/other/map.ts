export default class CustomMap<K, V> extends Map<K, V> {
	update(key: K, value: ((value?: Partial<V>) => V)): this {
		return this.set(key, value(this.get(key)));
	}

	map<T>(callback: (value: V, key: K, map: this) => T): T[] {
		const arr = [];

		for (const [key, value] of this) {
			arr.push(callback(value, key, this));
		}

		return arr;
	}

	filter(callback: (value: V, key: K, map: this) => boolean): V[] {
		const arr = [];

		for (const [key, value] of this) {
			if (callback(value, key, this)) arr.push(value);
		}

		return arr;
	}

	find(callback: (value: V, key: K, map: this) => boolean): V | undefined {
		for (const [key, value] of this) {
			if (callback(value, key, this)) return value;
		}

		return undefined;
	}

	every(callback: (value: V, key: K, map: this) => boolean): boolean {
		for (const [key, value] of this) {
			if (!callback(value, key, this)) return false;
		}

		return true;
	}
}
