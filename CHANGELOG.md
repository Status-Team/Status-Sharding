# Change Log

All notable changes to this project will be documented in this file.

## [1.3.0] - 2023-08-31

### Added
- Added message brokers, faster way for sending one-way IPC messages.
### Changed
- `token` on `ClusterManager` is now optional.
- Clusters and Shards will default to 1 if not specified and no `token` is provided.
### Fixed
- Fixed `ClusterManager#evalOnGuild` randomly throwing an error.
- Fix `ClusterManager#on('clusterReady')` not being called.