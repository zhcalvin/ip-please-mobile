# 独立部署全国排行榜

服务使用现有 Node.js 22.22+ 的内置 SQLite，不安装数据库服务或 npm 运行依赖。默认部署边界：

- SSH 主机：本机配置别名 `qc_light`。
- 域名：`api.momoyu.ltd`，独立 Nginx 站点和独立证书。
- 进程：`ip-please-ranking.service`，动态非 root 用户。
- 代码：`/opt/ip-please-ranking/releases/<版本>/`，`current` 软链指向当前版本。
- 数据：`/var/lib/ip-please-ranking/ranking.sqlite`，与其他应用数据库分开。
- 配置：`/etc/ip-please-ranking.env`，权限 `0600`，不进入 Git。
- 监听：`127.0.0.1:18765`，外部仅通过 HTTPS 访问。
- 资源：systemd 限制内存 192 MB、CPU 25%、进程/线程数 64。

## 微信配置

`WECHAT_APP_ID=wx2484d6db995ed6b2` 为当前小游戏 AppID。请仅在服务器私密配置中填写 `WECHAT_APP_SECRET`：

```bash
ssh qc_light
sudoedit /etc/ip-please-ranking.env
sudo systemctl restart ip-please-ranking
```

配置缺失时排行榜可读，微信登录和提交成绩返回服务未配置；服务不会使用模拟微信身份生成公开榜单。AppSecret、微信登录返回的 session_key、会话 token 不应写入提交或发布材料。

在微信公众平台的小游戏服务器域名中，将 `https://api.momoyu.ltd` 配置为 request 合法域名。开发者工具本地测试不能替代合法域名配置和真机测试。

## 上线步骤

1. 在本地运行客户端构建及所有 `wechat/tests/*.test.mjs`；确认服务端回放与客户端结算一致。
2. 建立独立发布目录，仅上传 `wechat/server/`、`wechat/shared/` 和引擎需要的原游戏脚本。原脚本放在发布目录 `game/` 下，环境变量 `GAME_SOURCE_DIR` 指向它。
3. 使用 `ip-please-ranking.service` 安装新的 systemd 服务，创建独立私密环境文件。只重启本服务。
4. 新建 `nginx-http.conf` 对应的独立站点，先 `nginx -t`，再平滑 reload。使用 webroot 方式为 `api.momoyu.ltd` 申请独立证书 `ip-please-api`，ACME 目录为 `/var/www/ip-please-acme`。
5. 使用 `nginx.conf` 启用独立 HTTPS 站点，先检查配置再 reload。无需修改 `momoyu.ltd` 等现有站点文件。
6. 验证健康检查、公开榜、缺少登录时的写入拒绝，以及现有网站页面/配置校验值。

## 验证与运维

```bash
curl -fsS https://api.momoyu.ltd/healthz
curl -fsS 'https://api.momoyu.ltd/v1/leaderboard?limit=20'
ssh qc_light 'systemctl status ip-please-ranking --no-pager'
ssh qc_light 'sudo journalctl -u ip-please-ranking -n 50 --no-pager'
```

独立证书的续期部署钩子为 [certbot-ip-please-api.sh](certbot-ip-please-api.sh)，安装到 `/etc/letsencrypt/renewal-hooks/deploy/ip-please-ranking-nginx.sh`，权限 `0755`、属主 root。Certbot 会为所有成功续期的证书调用 deploy hook，因此脚本先核对 `RENEWED_LINEAGE`：仅 `/etc/letsencrypt/live/ip-please-api` 会执行 `nginx -t`，成功后平滑 reload Nginx；其他证书直接退出。不会重启 Nginx 或业务进程。

更新钩子时先上传到唯一临时文件，再安装到固定路径：

```bash
scp wechat/deploy/certbot-ip-please-api.sh qc_light:/tmp/ip-please-api-hook-UNIQUE.sh
ssh qc_light 'sudo install -o root -g root -m 0755 /tmp/ip-please-api-hook-UNIQUE.sh /etc/letsencrypt/renewal-hooks/deploy/ip-please-ranking-nginx.sh'
```

可先执行 `sh -n` 做语法检查，再以其他 `RENEWED_LINEAGE` 验证无操作分支。验证本证书分支会触发一次配置检查和平滑 reload；无需重新申请或强制续期证书。确保系统 `certbot.timer` 保持启用。

回滚代码时把 `current` 软链切回上一个发布目录，再重启 `ip-please-ranking`。保持数据库和环境文件；涉及评分规则或 schema 变化时先备份数据库并检查迁移兼容性。不要停止其他服务或替换它们的 Nginx 配置。
