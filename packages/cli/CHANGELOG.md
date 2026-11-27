# Changelog

## [0.11.0](https://github.com/highnet/rallypoint/compare/rallypoint-v0.10.1...rallypoint-v0.11.0) (2026-11-27)


### Features

* **swarm:** dispatch roles as Codex Cloud tasks ([c1f92a6](https://github.com/highnet/rallypoint/commit/c1f92a6f9036859709bcf8de849d87e861844900))
* **swarm:** dispatch roles as Codex Cloud tasks ([07b3031](https://github.com/highnet/rallypoint/commit/07b30313590ae151e4f2177b10b1590a54f1629b))


### Bug Fixes

* **swarm:** bound and retry Codex Cloud status polling ([b21b9ec](https://github.com/highnet/rallypoint/commit/b21b9ec023380b9464663bf58c4a54041c46819e))

## [0.10.1](https://github.com/highnet/rallypoint/compare/rallypoint-v0.10.0...rallypoint-v0.10.1) (2026-11-27)


### Bug Fixes

* **swarm-ui:** show one header badge, Live while a session works and Idle otherwise ([fb0eb83](https://github.com/highnet/rallypoint/commit/fb0eb83a6bf2d4c0ed953332a4a8613a56d5ad9d))
* **swarm-ui:** show one header badge, Live while a session works and Idle otherwise ([81cf59e](https://github.com/highnet/rallypoint/commit/81cf59e6172760e3391c26722edc7067b4e3bda4))

## [0.10.0](https://github.com/highnet/rallypoint/compare/rallypoint-v0.9.0...rallypoint-v0.10.0) (2026-11-27)


### Features

* **swarm-ui:** animated fleet graph with replay on /swarm/fleet ([56fbfda](https://github.com/highnet/rallypoint/commit/56fbfda56910b1f23d2cdddcaee390fae736d5ad))
* **swarm-ui:** animated fleet graph with replay on /swarm/fleet ([e125eda](https://github.com/highnet/rallypoint/commit/e125edad8af37dd909d44b20ecb6f6f25b4f43c5))
* **swarm-ui:** copy buttons on prompts, commands and skill files ([f5f76f2](https://github.com/highnet/rallypoint/commit/f5f76f210336b7928d21d46f6f54a52df4d9e585))
* **swarm-ui:** copy buttons on prompts, commands and skill files ([25ff0bd](https://github.com/highnet/rallypoint/commit/25ff0bd2beb87cdfc6fa7724c8f7aa2b5d493a7a))
* **swarm-ui:** draw each fleet-graph agent as its own animal ([32813cb](https://github.com/highnet/rallypoint/commit/32813cb14613cb9f667087173dfeb6781d515864))
* **swarm-ui:** draw each fleet-graph agent as its own animal ([158ac78](https://github.com/highnet/rallypoint/commit/158ac780c29715ae733f4a5d72fdaa7bc5ae01bb))
* **swarm-ui:** make /swarm/messages a threaded message board ([bb0c7c5](https://github.com/highnet/rallypoint/commit/bb0c7c5500d20411452c9dae79af062eddddcb6b))
* **swarm-ui:** make /swarm/messages a threaded message board ([38801ed](https://github.com/highnet/rallypoint/commit/38801ed28370d4ec4a2824cd9d02755edbbff2fb))
* **swarm:** update the dashboard live through Supabase Realtime by default ([54c637a](https://github.com/highnet/rallypoint/commit/54c637a1de7b645dadc07bfc4c6506bbb7ef8408))
* **swarm:** update the dashboard live through Supabase Realtime by default ([cd8d681](https://github.com/highnet/rallypoint/commit/cd8d681d36f2e366cdde49d6e820213f4dc62155))


### Bug Fixes

* **cli:** refuse an empty secret under swarm connect --no-db ([aeae433](https://github.com/highnet/rallypoint/commit/aeae433b8b95e3b17244846b18dfc9bf74f39452))
* **loop:** give emulated git-data commits an identity, and pass the manifest check on Windows ([d5d25dc](https://github.com/highnet/rallypoint/commit/d5d25dc612c1aae363ee3ca0a66d014ca3b3dec3))
* **loop:** reach GitHub over REST in Claude Code cloud sessions ([34c1d02](https://github.com/highnet/rallypoint/commit/34c1d0271fb6319c89149b16ce8010a3ee801fdb))
* **loop:** resolve the fetch-once runner path with fileURLToPath ([922cc98](https://github.com/highnet/rallypoint/commit/922cc9801309c9cb2966645f575161e54dbdf877))
* **loop:** run Rallypoint and Swarm inside Claude Code cloud sessions ([8e82231](https://github.com/highnet/rallypoint/commit/8e82231bab65c844b27afc755328ba5809ead733))
* **loop:** write claims and leases with git push where git-data writes are refused ([d1d2031](https://github.com/highnet/rallypoint/commit/d1d203108a547402aecf05fe687dc539fb5ad31f))
* make swarm setup work in a brand-new repository ([5a156ff](https://github.com/highnet/rallypoint/commit/5a156ffa04a84a67ea10a1e28f0a6fabf1f4cf7b))
* make swarm setup work in a brand-new repository ([82f8bff](https://github.com/highnet/rallypoint/commit/82f8bffe52e975946881b42829b2c570adedfbb3))
* ship the fetch-once runner the gh-less API transport executes ([08396a7](https://github.com/highnet/rallypoint/commit/08396a7a38185a32985f82dbd246fe904ab475c9))
* ship the fetch-once runner the gh-less API transport executes ([55a5d25](https://github.com/highnet/rallypoint/commit/55a5d251441f6abbf6c7575c094e4142f4f19794))
* **swarm-ui:** add globe and home nav icons for links out of the dashboard ([994a259](https://github.com/highnet/rallypoint/commit/994a259ca61d8b768a2e62993de5618c24bc5334))
* **swarm-ui:** build and navigate under Next.js 16 Cache Components ([c751a8a](https://github.com/highnet/rallypoint/commit/c751a8af8ea78ac5d1f20029523c87b6ca4b4c94))
* **swarm-ui:** build and navigate under Next.js 16 Cache Components ([48c0cd8](https://github.com/highnet/rallypoint/commit/48c0cd8f87075026cfdfd66179c20467af5e8214)), closes [#70](https://github.com/highnet/rallypoint/issues/70)
* **swarm-ui:** compile the message board under the dashboard's strict tsconfig ([24b3da7](https://github.com/highnet/rallypoint/commit/24b3da7d6f17a7cab88ac141e5fdb70710b3ac44))
* **swarm-ui:** count the fleet on the overview's Right now band ([7e727f3](https://github.com/highnet/rallypoint/commit/7e727f399b655b901c670de863e3ed7bcec28680))
* **swarm-ui:** count the fleet on the overview's Right now band ([ebcbc67](https://github.com/highnet/rallypoint/commit/ebcbc67b9199a37fad689c354cfc8bae3e9ec36d))
* **swarm-ui:** drop force-dynamic from the message thread page ([1f8b95a](https://github.com/highnet/rallypoint/commit/1f8b95a3f2cafbafb6aa2f43f3291be08d79e82b))
* **swarm-ui:** give project nav entries real icons instead of a dot ([62831ea](https://github.com/highnet/rallypoint/commit/62831ea88b8cae982a38010f2365b1645d93ab54))
* **swarm-ui:** give project nav entries real icons instead of a dot ([5974ed2](https://github.com/highnet/rallypoint/commit/5974ed2aea564c1f53c18eee858e4a8023376e0e))
* **swarm-ui:** give the message thread's reply command a copy button ([d68be44](https://github.com/highnet/rallypoint/commit/d68be4432a0b517173172d1d6062e89fdf219b59))
* **swarm-ui:** keep the main column's padding when a hidden overview stays mounted ([1057aee](https://github.com/highnet/rallypoint/commit/1057aee37ebe392b557b9c3e7cb030dc3157f16b))
* **swarm-ui:** keep the main column's padding when a hidden overview stays mounted ([1605322](https://github.com/highnet/rallypoint/commit/1605322a12497ba6677e904cc7bb17d500fb3741))
* **swarm-ui:** make setup and error banners say exactly what to do ([5c5f897](https://github.com/highnet/rallypoint/commit/5c5f89756dc2877dffb9ff7527ff243daa0197c8))
* **swarm-ui:** make setup and error banners say exactly what to do ([57abce0](https://github.com/highnet/rallypoint/commit/57abce0be64e59354b8690df9d2a45f326565c4e))
* **swarm-ui:** ship guidance.ts in both UI items ([7e08afb](https://github.com/highnet/rallypoint/commit/7e08afbc62b6831cf78a165d5641f7d8c02a568f))
* **swarm-ui:** type swarm_fleet rows as the view returns them ([1bd4872](https://github.com/highnet/rallypoint/commit/1bd48726e72589da69cab136c165f1de0f43dff2))
* **swarm:** pin search_path on swarm_realtime_wanted and hold live updates during a fleet replay ([ce1166d](https://github.com/highnet/rallypoint/commit/ce1166d74b3868f7e6130fc0242d80dbbf33ac07))

## [0.9.0](https://github.com/highnet/rallypoint/compare/rallypoint-v0.8.0...rallypoint-v0.9.0) (2026-11-25)


### Features

* **swarm-ui:** give the dashboard a results-site overview out of the box ([#67](https://github.com/highnet/rallypoint/issues/67)) ([1885b51](https://github.com/highnet/rallypoint/commit/1885b5133a85083e2526d0bca707bfe42120acea))

## [0.8.0](https://github.com/highnet/rallypoint/compare/rallypoint-v0.7.0...rallypoint-v0.8.0) (2026-11-25)


### Features

* **cli:** add swarm connect; fix init labels, empty repos and plan labels ([#64](https://github.com/highnet/rallypoint/issues/64)) ([658049b](https://github.com/highnet/rallypoint/commit/658049b5eb276ee4b2ccf40027577c4d2cf59c3e))

## [0.7.0](https://github.com/highnet/rallypoint/compare/rallypoint-v0.6.0...rallypoint-v0.7.0) (2026-11-25)


### Features

* **site:** the orchestrator's fleet, vanilla prompts, Arena screenshots, easier wizard ([#62](https://github.com/highnet/rallypoint/issues/62)) ([d6efa03](https://github.com/highnet/rallypoint/commit/d6efa0370fbae9af0ef3757613313ea6cecc5ff8))
* **swarm:** genesis interviews the operator with interview-me and initializes Impeccable ([#63](https://github.com/highnet/rallypoint/issues/63)) ([42e03fb](https://github.com/highnet/rallypoint/commit/42e03fbc4fbaf681d650844a32b82b6ca2d6dbc3))


### Bug Fixes

* **cli:** point package metadata at highnet/rallypoint so npm provenance verifies ([#60](https://github.com/highnet/rallypoint/issues/60)) ([20c4dc9](https://github.com/highnet/rallypoint/commit/20c4dc9a0ee1241d2c9ce45df8afa04910d5ceb0))

## [0.6.0](https://github.com/highnet/rallypoint/compare/rallypoint-v0.5.0...rallypoint-v0.6.0) (2026-11-25)


### Features

* Rallypoint Swarm, the next tier of Rallypoint ([#57](https://github.com/highnet/rallypoint/issues/57)) ([e4d9274](https://github.com/highnet/rallypoint/commit/e4d92744e30d12052c070abeeb642958fc30e9e8))

## [0.5.0](https://github.com/highnet/rallypoint/compare/rallypoint-v0.4.0...rallypoint-v0.5.0) (2026-10-28)


### Features

* add an improver role that tunes the loop on measured results ([1558e96](https://github.com/highnet/rallypoint/commit/1558e9626672d57cf3f9a17c0b14d52476ae9abe))
* make Rallypoint a self-improving graph with an improver role ([c8b22d8](https://github.com/highnet/rallypoint/commit/c8b22d848a9f70904973fcee3517340ea567b33b))

## [0.4.0](https://github.com/highnet/rallypoint/compare/rallypoint-v0.3.0...rallypoint-v0.4.0) (2026-08-11)


### Features

* automate CLI releases with release-please and enforce conventional commits ([5a76729](https://github.com/highnet/rallypoint/commit/5a76729a80a4a77c10af41eb2bfb07ff8fef6e2a))
* launch first-party CLI and campaign experience ([bae0ca7](https://github.com/highnet/rallypoint/commit/bae0ca7e7c724ee3779556421894cb44cc45f90f))
* **registry:** ship the full loop protocol and adopt the hold-label model ([f4d3d75](https://github.com/highnet/rallypoint/commit/f4d3d750a6b4aa77fb656182edd5ee970da586d8))
* **site:** add the merger to the bestiary and ship the 0.4.0 registry ([a0716a9](https://github.com/highnet/rallypoint/commit/a0716a97578aee97af85eeca54042c0bf32098a4))
