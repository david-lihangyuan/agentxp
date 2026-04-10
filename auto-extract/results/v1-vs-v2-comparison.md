# v1 vs v2 提取对比报告

日期: 2026-04-10
模型: gpt-4o-mini
v1 prompt: extract-prompt-v1.txt
v2 prompt: extract-prompt-v2.txt


## 数据丢失调查修复

| 维度 | v1 | v2 |
|------|----|----|
| 提取数(raw) | 1 | 2 |
| 通过验证 | 0 | 2 |
| 被拒绝 | 1 | 0 |
| Tokens | 7231 | 8046 |
| 耗时(ms) | 8869 | 8773 |

### v1 经验
- **数据丢失事件的根因分析与防护措施** (confidence: 0.9)
  - tags: []
  - learned: 手动操作的每一步都是出错的机会，自动化部署流程可以显著减少错误风险。建议在部署时使用脚本来确保只传输必要的文件，并排除敏感数据目录。
  - ❌ v2验证拒绝: too few English tags (< 2 after CJK removal)

### v2 经验
- **Prevented database overwrite during deployment** (confidence: 0.9)
  - tags: [deployment, scp, sqlite, data-loss, automation]
  - learned: Always use a deployment script that excludes sensitive directories like data/ to avoid accidental overwrites. Implementing a CI/CD pipeline would further reduce manual errors in deployment.
  - ✅ 验证通过
- **Implemented automated database backups** (confidence: 0.85)
  - tags: [backup, cron, sqlite, data-safety]
  - learned: Regular automated backups are essential for data integrity, especially in production environments. Use cron jobs for scheduled tasks to ensure data safety.
  - ✅ 验证通过

## 失败经验高亮功能

| 维度 | v1 | v2 |
|------|----|----|
| 提取数(raw) | 1 | 1 |
| 通过验证 | 0 | 1 |
| 被拒绝 | 1 | 0 |
| Tokens | 7310 | 7983 |
| 耗时(ms) | 6039 | 5014 |

### v1 经验
- **实现失败经验高亮和置顶逻辑** (confidence: 0.9)
  - tags: [typescript, nodejs, search, experience]
  - learned: 在设计搜索功能时，使用加权而非硬排序来处理失败经验的优先级，可以确保在相似度接近时，失败经验的安全价值被优先考虑，而不会影响更高相似度成功经验的显示。
  - ❌ v2验证拒绝: learned lacks specific/actionable detail

### v2 经验
- **Implement Phase 1.7: Highlight failed experiences in precision search results** (confidence: 0.9)
  - tags: [search, typescript, experience-highlighting, agentxp]
  - learned: When implementing a weighting system for search results, ensure that the weights do not allow lower-scoring failed experiences to overshadow higher-scoring successful ones. The weighting should only a
  - ✅ 验证通过

## Harvester Docker采集

| 维度 | v1 | v2 |
|------|----|----|
| 提取数(raw) | 3 | 3 |
| 通过验证 | 2 | 2 |
| 被拒绝 | 1 | 1 |
| Tokens | 3701 | 4348 |
| 耗时(ms) | 27137 | 19044 |

### v1 经验
- **解决 Docker volume 非 root 权限问题** (confidence: 0.9)
  - tags: [docker, permissions, bind-mount, non-root, volume, linux, uid-gid, entrypoint, security]
  - learned: 在 Docker 中，确保容器内的用户 UID/GID 与宿主机一致是解决权限问题的关键，使用 chown 在 entrypoint 中调整权限可以有效避免权限拒绝错误。
  - ✅ v2验证通过
- **优化 Dockerfile build cache 级联失效** (confidence: 0.9)
  - tags: [docker, dockerfile, build-cache, layer-caching, optimization, ci-cd, buildkit, npm, pip]
  - learned: Dockerfile 的指令顺序对缓存的影响很大，合理利用 BuildKit 的缓存功能和 CI/CD 的 registry 缓存可以显著提高构建效率，减少构建时间。
  - ✅ v2验证通过
- **排查 Docker 容器网络不通问题** (confidence: 0.9)
  - tags: [docker, networking, bridge, docker0, ip-conflict, iptables, ip-forwarding, troubleshooting]
  - learned: 在 Docker 网络故障排查中，检查子网配置和 IP 转发设置是关键，iptables 规则也可能影响容器间的网络通信，需仔细检查。
  - ❌ v2验证拒绝: learned lacks specific/actionable detail

### v2 经验
- **解决 Docker volume 非 root 权限问题** (confidence: 0.9)
  - tags: [docker, permissions, bind-mount, non-root, volume, linux, uid-gid, entrypoint, security]
  - learned: 在 Docker 容器中，确保卷的权限与容器内用户的 UID/GID 匹配是解决权限问题的关键。使用 entrypoint 脚本动态调整权限可以有效避免权限拒绝错误。
  - ✅ 验证通过
- **优化 Dockerfile build cache 级联失效问题** (confidence: 0.85)
  - tags: [docker, dockerfile, build-cache, layer-caching, optimization, ci-cd, buildkit]
  - learned: Dockerfile 中指令的顺序会影响 build cache 的有效性。使用 BuildKit 的 cache mount 和 CI/CD registry caching 可以显著提高构建效率，减少时间浪费。
  - ✅ 验证通过
- **排查 Docker 容器网络不通问题** (confidence: 0.9)
  - tags: [docker, networking, bridge, docker0, ip-conflict, iptables, ip-forwarding, troubleshooting]
  - learned: Docker 容器网络问题常常与 docker0 子网配置、IP 转发和 iptables 规则有关。定期检查这些设置可以有效避免网络通信问题。
  - ❌ 被拒绝: learned lacks specific/actionable detail

### v2 拒绝详情
- ❌ "排查 Docker 容器网络不通问题" — learned lacks specific/actionable detail