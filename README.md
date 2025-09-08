## Introduction

Welcome to Status Sharding! This package is designed to provide an efficient and flexible solution for sharding Discord bots, allowing you to scale your bot across multiple processes or workers.

## Features

- **Efficient Sharding**: The sharding package utilizes an optimized sharding algorithm to distribute bot functionality across multiple shards and clusters.
- **Enhanced Performance**: Improve your bot's performance by leveraging the power of parallel processing and multi-threading.
- **Flexible Configuration**: Easily configure the number of shards, clusters, and other parameters to suit your bot's needs.
- **Comprehensive Documentation**: Detailed documentation and usage examples are provided to help you get started quickly.
- **Scalability**: Scale your bot's capabilities by distributing the workload across multiple processes or workers.
- **Customizable**: Extend and customize the sharding package to adapt it to your specific requirements.
- **Discord.js Core Library Support**: Works seamlessly with **discord.js** as well as its **core sub-libraries** (e.g., `@discordjs/rest`, `@discordjs/ws`, etc.).
- **Cross Hosting Support**: _Comming soon!_

## Comparison

Here's a comparison between Status Sharding, Discord Hybrid Sharding and Discord.js Sharding.

| Feature                     | Status Sharding | Discord Hybrid Sharding | Discord.js Sharding |
| --------------------------- | --------------- | ----------------------- | ------------------- |
| Flexible configuration      | ✔️              | ✔️                      | ✔️                  |
| Clustering Support          | ✔️              | ✔️                      | ❌                  |
| Processes & Workers         | ✔️              | ✔️                      | ❌                  |
| Comprehensive documentation | ✔️              | ❌                      | ❌                  |
| Performance optimization    | ✔️              | ❌                      | ❌                  |
| Discord.js core lib support | ✔️              | ❌                      | ❌                  |

## Installation

```bash
npm install status-sharding
pnpm add status-sharding
yarn add status-sharding
```

## Usage

### Basic Cluster Setup

This example demonstrates how to set up a cluster manager with Status Sharding. It works with any client implementation, providing automated shard distribution and cluster management.

```javascript
// import { ClusterManager } from 'status-sharding';
const { ClusterManager } = require("status-sharding");

const manager = new ClusterManager("./path-to-client.js", {
  mode: "worker", // or process
  token: "very-secret-token", // optional, for auto-calculation leave empty
  totalShards: 1, // leave empty for auto calculation
  totalClusters: 1, // shards are distributed over clusters
  shardsPerClusters: 1,
});

manager.on("clusterReady", (cluster) => {
  console.log(`Cluster ${cluster.id} is ready.`);
});

manager.on("ready", () => console.log("All clusters are ready."));

manager.spawn();
```

> **Note:** Replace `'./path-to-client.js'` with your actual client file path, and `'very-secret-token'` with your Discord bot token.

---

### Usage with discord.js

Here’s a minimal example of using Status Sharding with **discord.js**. It leverages the `ShardingClient` class to handle shards automatically.

```javascript
// import { ShardingClient } from 'status-sharding';
// import { GatewayIntentBits, Events } from 'discord.js';
const { ShardingClient } = require("status-sharding");
const { GatewayIntentBits, Events } = require("discord.js");

const client = new ShardingClient({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once(Events.ClientReady, () => {
  console.log("Ready!");
});

client.login("very-secret-token");
```

This setup ensures your bot scales efficiently without requiring manual shard management.

---

### Usage with @discordjs/core

For developers using **@discordjs/core**, Status Sharding provides `ShardingCoreClient` to integrate seamlessly with the core library and REST API.

```javascript
// import { ShardingCoreClient } from 'status-sharding/core';
// import { GatewayDispatchEvents, GatewayIntentBits } from '@discordjs/core';
const { ShardingCoreClient } = require("status-sharding/core");
const { GatewayDispatchEvents, GatewayIntentBits } = require("@discordjs/core");

const client = new ShardingCoreClient({
  token: "very-secret-token",
  gateway: {
    intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildMembers,
  },
  rest: {
    version: "10",
  },
});

client.once(GatewayDispatchEvents.Ready, () => {
  console.log("Ready!");
});

client.gateway.connect();
```

This example demonstrates full integration with `@discordjs/core`, including gateway connection and event handling, while still benefiting from automated shard and cluster management.

---

For more information, please refer to the [documentation](https://help.crni.xyz/status-sharding/introduction).

---

## Credits

- This clone was created by [Digital](https://crni.xyz/). The original can be found [here](https://github.com/meister03/discord-hybrid-sharding).
- Special thanks to maintainers for their work on the initial package, which served as the foundation for this clone. Their contributions are greatly appreciated.
- Please note that this clone is an independent project and may have diverged from the original discord-hybrid-sharding package in certain aspects.

## Dependencies

- [discord.js](https://www.npmjs.com/package/discord.js) (v14.14.1 or higher)
- [@discordjs/core](https://www.npmjs.com/package/@discordjs/core) (v2.2.1, optional)
- [@discordjs/rest](https://www.npmjs.com/package/@discordjs/rest) (v2.6.0, optional)
- [@discordjs/ws](https://www.npmjs.com/package/@discordjs/ws) (v2.0.3, optional)

## License

This project is licensed under the GNU General Public License v3.0. See the [LICENSE](./LICENSE) file for details.
