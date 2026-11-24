# 部署到阿里云轻量服务器

给这台已经买好的 Ubuntu 24.04 轻量应用服务器用。程序仍是一个 Node 进程，页面和接口都由它提供。前面加 Nginx，只把 80 和 443 暴露到公网。

镜像用系统镜像里的 Ubuntu 24.04。不要用应用镜像里的云·原生建站、WordPress、LAMP，也不要用预装 Node.js 的应用镜像，那些镜像里的 Node 往往低于 22。

## 服务器上要有什么

- Node.js 22 或更高。数据库用的是 Node 自带的 SQLite，不用另装 MySQL 或 Redis。
- Nginx。它监听公网，再转发到本机 `127.0.0.1:3840`。
- 代码放在 `/opt/cp`。数据库是 `/opt/cp/data/app.sqlite`。

`HOST` 保持 `127.0.0.1`，不要改成 `0.0.0.0`。公网不要放行 3840。

Node 服务运行时会自行执行每日自动同步，不需要另设 cron：北京时间 21:30–22:30 每 5 分钟检查一次。某个彩种要等官网最新一期的开奖日是当天，才算完成并停止；管理中心可查看各彩种状态。同步成功后，以及每次启动时，三个官方彩种只保留最新 500 期，并补最近 15 期里缺失的预测存档。自开3D的开奖在 `self_draws`，不参与这两步。systemd 必须保持服务运行。

## 1. 防火墙

在轻量服务器控制台的防火墙里放行 **22、80、443**。不要放行 3840。

## 2. 登录并安装 Node 22

用控制台里的公网 IP 和 root 密码 SSH 登录。Ubuntu 24.04 自带的 Node 版本不够。

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs nginx
node -v
```

`node -v` 应显示 v22 或更高。

## 3. 上传代码

在自己电脑的项目目录执行。只上传服务端和前端源文件，不要上传 `node_modules`、`web/dist` 和 `data/admin-initial.txt`。为避免把本机依赖和构建产物传上去，分两次上传：

```bash
scp -r server.js package.json src root@你的公网IP:/opt/cp/
scp -r web/src web/index.html web/package.json web/package-lock.json web/vite.config.js root@你的公网IP:/opt/cp/web/
```

如果目录还不存在，先在服务器上执行 `mkdir -p /opt/cp`。

要把现在这台电脑上的开奖、账号和试玩余额一起带过去时，再单独传数据库：

```bash
ssh root@你的公网IP "mkdir -p /opt/cp/data"
scp data/app.sqlite root@你的公网IP:/opt/cp/data/app.sqlite
```

不传这个文件时，服务器第一次启动会新建空库，并在 `/opt/cp/data/admin-initial.txt` 写下新的管理员账号和密码。看完后删掉这个文件。已有的 `app.sqlite` 不会重新生成密码。

新建用户或由超级管理员重置密码后，临时密码只用于首次登录；用户必须先修改密码才能继续使用。

## 4. 构建并用 systemd 常驻

在服务器上：

```bash
cd /opt/cp
npm run build
```

新建 `/etc/systemd/system/cp.service`：

```ini
[Unit]
Description=cp
After=network.target

[Service]
WorkingDirectory=/opt/cp
Environment=HOST=127.0.0.1
Environment=PORT=3840
ExecStart=/usr/bin/node server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

然后：

```bash
systemctl daemon-reload
systemctl enable --now cp
systemctl status cp
```

`status` 里应能看到 `http://127.0.0.1:3840`。失败时看日志：

```bash
journalctl -u cp -n 50 --no-pager
```

## 5. Nginx 转发

新建 `/etc/nginx/sites-available/cp`：

```nginx
server {
    listen 80;
    server_name 你的域名或公网IP;
    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:3840;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/cp /etc/nginx/sites-enabled/cp
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

浏览器打开 `http://公网IP`。能看到登录页，说明已经跑起来了。登录 Cookie 不要求 HTTPS，先用 HTTP 测试登录即可。

登录接口带一次性图片验证码、账号/IP 组合失败冷却和每 IP 失败次数限制。Nginx 的 `X-Real-IP` 和 `X-Forwarded-Proto` 头要保留，服务端据此识别真实客户端，并在 HTTPS 时给 Cookie 加 `Secure`。

## 6. 域名、备案和 HTTPS

服务器在中国大陆。用自己的域名对外提供网站之前，要先做 ICP 备案。备案通过后，把域名解析到这台机器的公网 IP，再把上面的 `server_name` 改成该域名。

备案完成前，用 IP 访问做测试。正式给别人用时再上 HTTPS。可以用阿里云免费证书，或在服务器上用 Certbot 申请 Let's Encrypt，让 Nginx 监听 443，并继续转发到 `127.0.0.1:3840`。仅在 HTTPS 的 Nginx 站点配置中添加 `add_header Strict-Transport-Security "max-age=31536000" always;`，不要在 HTTP/IP 测试站点添加。

应用会发送防点击劫持、MIME 嗅探、内容安全策略和搜索引擎禁止索引响应头，`/robots.txt` 也禁止爬虫抓取。需要额外的 Nginx 入口限流时，可在 `/etc/nginx/nginx.conf` 的 `http {}` 内添加 `limit_req_zone $binary_remote_addr zone=cp_login:10m rate=10r/m;`，并在站点配置中为 `/api/login` 增加 `limit_req zone=cp_login burst=5 nodelay;`。应用自身的账号/IP 限流仍会继续生效。

## 以后更新

在自己电脑的项目目录执行 `deploy.ps1`。它用 `~/.ssh/cp_aliyun` 上传 `server.js`、`src/`、`web/src` 和这三份说明，不上传 `data/`，然后在服务器上构建并重启 `cp`。不要覆盖服务器上的 `/opt/cp/data/app.sqlite`，除非就是想用电脑上的库替换线上库。

在服务器上：

```bash
cd /opt/cp
npm run build
systemctl restart cp
```

改了 `server.js` 或 `src/` 必须重启。只改了页面并重新构建，重启后刷新浏览器即可。

数据库字段更新由 `src/db.js` 启动时做兼容迁移；通常只上传代码、重新构建并重启即可，不要用本机数据库覆盖服务器数据库。只有明确要替换线上数据时才上传本机 `data/app.sqlite`。

定期备份服务器上的 `/opt/cp/data/app.sqlite`。为避免复制过程中数据库仍在写入，先短暂停服务，再从自己电脑下载，最后恢复服务：

```bash
ssh root@你的公网IP "systemctl stop cp"
scp root@你的公网IP:/opt/cp/data/app.sqlite data/app.sqlite
ssh root@你的公网IP "systemctl start cp"
```
