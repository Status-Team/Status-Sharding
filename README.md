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
yarn add status-sharding
```

For more information, please refer to the [documentation](https://help.crni.xyz/status-sharding/introduction).

## Credits

- This clone was created by [Digital](https://crni.xyz/). The original can be found [here](https://github.com/meister03/discord-hybrid-sharding).
- Special thanks to maintainers for their work on the initial package, which served as the foundation for this clone. Their contributions are greatly appreciated.
- Please note that this clone is an independent project and may have diverged from the original discord-hybrid-sharding package in certain aspects.

## Dependencies

- [discord.js](https://www.npmjs.com/package/discord.js) (v14.14.1 or higher)
- [@discordjs/core](https://www.npmjs.com/package/@discordjs/core) (v2.2.1, optional)
- [@discordjs/rest](https://www.npmjs.com/package/@discordjs/rest) (v2.6.0, optional)
- [@discordjs/ws](https://www.npmjs.com/package/@discordjs/ws) (v2.0.3, optional)
