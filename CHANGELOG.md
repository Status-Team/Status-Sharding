# Change Log

All notable changes to this project will be documented in this file.

## [1.3.4] - 2023-09-16
- Added `ShardingUtils#removeNonExisting` which removes undefined or null values from an array.

## [1.3.3] - 2023-09-16
- Improved types for non-sterilized variables.

## [1.3.1] - 2023-08-31

### Added
- Added `ClusterClient#broadcast` which sends a message to all clusters, including/excluding the current cluster.

## [1.3.1] - 2023-08-31

### Added
- Added `ClusterManager#on('message')` which is emitted when a message is received from a cluster.

## [1.3.0] - 2023-08-31

### Added
- Added message brokers, faster way for sending one-way IPC messages.
### Changed
- `token` on `ClusterManager` is now optional.
- Clusters and Shards will default to 1 if not specified and no `token` is provided.
### Fixed
- Fixed `ClusterManager#evalOnGuild` randomly throwing an error.
- Fix `ClusterManager#on('clusterReady')` not being called.