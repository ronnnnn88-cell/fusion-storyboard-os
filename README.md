# Fusion Storyboard OS V4.2

Fusion Storyboard OS V4.2 是一个纯 HTML、CSS、JavaScript 的商业视频分镜工具。V4.2 保留 V4 的全部本地功能，并新增 GitHub Pages + Google Drive 项目级云端存档。

不需要 React、npm、Firebase、Supabase、传统后端或登录数据库。

## V4.2 Architecture

```text
GitHub Pages (Web App)
        |
        +-- Google Identity Services (OAuth access token in memory only)
        |
        +-- Google Drive (one ZIP package per storyboard project)
        |
        +-- localStorage (text, metadata, settings, last good save)
        |
        +-- IndexedDB (compressed reference image blobs)
```

- GitHub Pages 只托管程序文件，不保存客户项目、图片或 access token。
- Google Drive 保存正式共享项目，每个 Drive 文件只包含一个 Storyboard project。
- localStorage 保存本机项目文字、shot、sequence、图片 metadata、设置和最近良好存档。
- IndexedDB 保存压缩后的 reference image blobs。
- 浏览器本地资料仍是离线工作缓存；Drive 暂时失败不会删除本地资料。

## Files

```text
index.html
style.css
script.js
README.md
config.example.js
config.js
.gitignore
.nojekyll
```

`config.js` 默认被 `.gitignore` 排除。部署者可从 `config.example.js` 建立自己的配置。

## Local Use

不需要 Google Drive 时，可以双击 `index.html` 使用所有本地功能，包括 Projects、Sequences、Shoot Mode、IndexedDB 图片、PDF、CSV、JSON 和 Package。

Google OAuth 不支持可靠的 `file://` 授权。测试 Google Drive 时，请使用 GitHub Pages HTTPS URL，或在这个文件夹运行：

```bash
python -m http.server 8080
```

然后打开：

```text
http://localhost:8080
```

Chrome 是建议浏览器。

## Storage

localStorage key：

```text
fusion_storyboard_os_projects
fusion_storyboard_os_last_good_projects
fusion_storyboard_drive_folder_id
fusion_storyboard_last_drive_file_id
fusion_storyboard_last_drive_file_name
fusion_storyboard_drive_auto_save
```

localStorage 保存项目文字、metadata、sequence references、状态、顺序和设置，不保存 Google access token，也不保存完整图片。

IndexedDB：

```text
Database: fusion_storyboard_os_images
Object store: reference_images
```

每张分镜图在项目资料里只保存 `id`、`fileName`、`type`、`createdAt` 和 `indexedDbKey`。完整压缩图片 blob 存在 IndexedDB。

## Google Cloud Setup

1. 在 Google Cloud Console 建立 Project。
2. Enable Google Drive API。
3. 如果要使用 Google Picker 选择共享文件或文件夹，Enable Google Picker API。
4. 设置 OAuth consent screen。
5. 建立 OAuth Client ID，Application type 选择 Web application。
6. 在 Authorized JavaScript origins 加入 GitHub Pages origin，例如 `https://username.github.io`。
7. 本地测试加入 `http://localhost:8080`。
8. Origin 只能包含 scheme、host 和 port，不要加入 repository path。
9. 建立 API Key，限制为你的 GitHub Pages / localhost 来源，并限制到 Google Picker API。
10. Google App ID 使用 Google Cloud project number。
11. 复制 `config.example.js` 为 `config.js`，填入 Client ID、API Key 和 App ID。

```js
window.FUSION_CONFIG = {
  GOOGLE_CLIENT_ID: "YOUR_GOOGLE_OAUTH_CLIENT_ID",
  GOOGLE_API_KEY: "YOUR_GOOGLE_API_KEY",
  GOOGLE_APP_ID: "YOUR_GOOGLE_CLOUD_PROJECT_NUMBER"
};
```

Client ID、API Key 和 App ID 会出现在浏览器前端，它们不是 Client Secret。请限制 API Key 的来源和 API 范围。绝对不要把 Client Secret、access token 或客户资料放进 GitHub。

如果 GitHub Pages 必须读取 `config.js`，可以提交只包含 Client ID、受限制 API Key 和 App ID 的配置文件，例如使用 `git add -f config.js`。Client Secret 仍然绝对不能提交。

## GitHub Pages Deployment

1. 建立 GitHub repository。
2. 上传 `index.html`、`style.css`、`script.js`、`README.md`、`config.js` 和 `.nojekyll`。
3. 打开 repository Settings。
4. 打开 Pages。
5. Source 选择 Deploy from a branch。
6. Branch 选择 `main`。
7. Folder 选择 `/ (root)`。
8. 保存并等待部署完成。
9. 打开 `https://username.github.io/repository-name/`。
10. 把这个完整 Pages URL 对应的 origin 加入 OAuth Authorized JavaScript origins。

所有 CSS、JS 和 config 路径都使用相对路径，兼容 GitHub Project Pages 的 repository 子路径。

## Google Drive Workflow

### Connect

点击顶部 `Connect Google Drive`。App 使用 Google Identity Services token model，并只申请：

```text
https://www.googleapis.com/auth/drive.file
```

Access token 只保存在当前页面 memory，不写入 localStorage。页面刷新或 token 过期后需要重新连接。

第一次连接时：

- `Create Fusion Storyboard OS Folder`：在 My Drive 建立默认文件夹。
- `Choose Existing Drive Folder`：使用 Google Picker 选择已授权或共享文件夹。

Folder ID 可以保存到 localStorage，因为它不是 access token。

### Save As New Drive File

1. 打开一个本地项目。
2. Connect Google Drive。
3. 建立或选择 Fusion Storyboard OS folder。
4. 点击 `Save As New Drive File`。
5. 输入 `.storyboard.zip` 或 `.fsb` 文件名。
6. App 只打包当前 project、sequences 和它的 IndexedDB reference images。
7. 成功后，这个 Drive 文件成为当前项目文件。

如果同名文件已存在，App 会询问是否覆盖，不会静默覆盖。

### Save To Drive

`Save To Drive` 更新当前 Drive 文件。保存前 App 会读取 Drive 的 `modifiedTime`，检查文件是否被其他设备修改。

- 小于 5 MB：multipart upload。
- 5 MB 或以上：resumable upload。
- Drive 失败时，本地 localStorage 和 IndexedDB 不会被删除。

### Open From Drive

1. Connect Google Drive。
2. 点击 `Open From Drive`。
3. 从当前 Fusion Storyboard OS folder 列表打开项目。
4. 也可以使用 `Choose Drive File` 通过 Google Picker 打开共享文件或 Shared Drive 文件。
5. App 下载完整 Package，恢复 project、storyboards、sequences、图片 metadata 和 IndexedDB blobs。

若当前 Drive 项目有未上传改动，App 会提供：

- Save To Drive First
- Export Package
- Discard Local Changes
- Cancel

### Share With Team

在 Google Drive 中分享 `Fusion Storyboard OS` 文件夹或单个 `.storyboard.zip` / `.fsb` 文件。团队成员打开同一个 GitHub Pages URL，用自己的 Google 账号连接，然后使用 `Open From Drive`。

V4.2 支持不同设备接力编辑，不是实时多人协作。最安全流程是一个人 Save 并关闭后，另一个人再 Open。

## Cloud Conflict

如果 Drive 文件的 `modifiedTime` 与打开时记录不同，App 停止覆盖并显示 `Cloud Conflict Detected`：

- Download Latest Version：放弃当前云端保存并打开较新版本。
- Save My Version As New File：把本机版本另存新文件。
- Force Overwrite：第二次确认后覆盖较新 Drive 文件。
- Cancel：保留本机资料，不上传。

不建议两个人同时编辑同一个项目。两台电脑同时编辑仍可能产生版本冲突；V4.2 只能尽量防止误覆盖，不能合并双方修改。

## Drive Auto Save

Drive Auto Save 默认关闭。开启后，只有在以下条件同时成立时才会在停止操作 30 秒后上传：

- 已连接 Google Drive。
- 当前 project 已有 Drive fileId。
- 有 Drive Changes Pending。
- 没有其他上传正在进行。

自动保存也会执行 conflict check。页面关闭前如果仍有 Drive Changes Pending，浏览器会提示。

## Local Backup And Restore

- `Export Local JSON Backup` / `Export JSON`：保存全部项目文字和 image metadata，不包含 IndexedDB blobs。
- `Import Local JSON Backup` / `Import JSON`：恢复文字资料。
- `Export Current Project Package`：保存当前项目和完整图片。
- `Export All Projects Backup`：保存所有本地项目和完整图片。
- `Import Project Package`：恢复 Package 中的项目和图片。

在新电脑恢复完整项目时，优先使用 Package 或 Open From Drive；不要只导入 JSON，否则图片 blob 不会随 JSON 移动。

V4.2 Package 继续使用：

```text
fusion-storyboard-package.json
images/
  image_xxx.jpg
```

Package Import 兼容 V3、V3.2、V4 和 V4.2 的 Fusion Storyboard OS package。新的 Drive 单项目文件也使用同一格式。

## Existing Features

- Project management
- Master Shot Library
- Multi-Sequence Workflow
- Independent sequence ordering
- Card View and Shot List View
- Shoot Mode and shared shot status
- Shot Filters and Batch Actions
- Dashboard
- Call Sheet
- Optimize Shooting Order
- Script to Storyboard
- AI Image Prompt
- Multiple Reference Images
- IndexedDB image storage
- Image preview lightbox
- PDF versions: Client, Director, Production, Editor
- CSV export
- JSON import/export
- Package ZIP import/export
- Schema migration
- Save protection and LAST_GOOD_KEY
- Storage Health
- Responsive phone/tablet layout

Schema version:

```text
schemaVersion: 5
```

旧 V3、V3.2 和 V4 项目在载入时会自动补上 sequences 与 `cloudMetadata` 默认值，不改变旧 IndexedDB image keys。

## Troubleshooting

- `Google config missing`：检查 `config.js` 和 `GOOGLE_CLIENT_ID`。
- `Google Drive API unavailable`：检查网络、Drive API、广告拦截器和第三方脚本限制。
- `Authorization denied`：重新 Connect，并确认测试用户 / OAuth consent 配置。
- `Browser blocked popup`：允许 GitHub Pages 网站弹窗。
- `Access token expired`：重新 Connect Google Drive。
- `Folder not found` / `File not found`：检查文件是否被删除、移动或取消共享。
- `User does not have permission`：请文件拥有者重新分享，或用正确 Google 账号连接。
- `Drive quota exceeded`：释放 Google Drive 空间。
- `Offline`：继续使用本地缓存，联网后再 Save To Drive。
- `Package corrupted`：重新下载原始 Package，不要解压后重新压缩成其他 ZIP 格式。
- `Package missing images`：文字与 metadata 仍会恢复；console 会列出缺失图片。
- `IndexedDB unavailable`：改用 Chrome，检查隐私模式和浏览器存储权限。
- `Local Save Failed`：立即 Export Package 或 JSON backup，不要关闭页面。

## Known Limitations

- 不是实时多人协作系统，没有自动 merge。
- Google access token 不持久化，刷新后需要重新连接。
- `drive.file` 是最小权限；打开别人建立的共享文件通常需要 Google Picker 授权。
- Google Picker 需要 API Key 和 App ID；没有 Picker 配置时只能列出 App 当前文件夹中的文件或手动输入 folder ID。
- Google OAuth 不能通过双击 `file://` 可靠运行，必须使用 HTTPS 或 localhost。
- 浏览器和 Google Drive 都有存储 / quota 限制；大型图片项目应定期保留离线 Package。
- IndexedDB 图片压缩策略保持 V4 不变，最大宽度 1600px、JPEG quality 0.82。
- PDF 仍依赖浏览器 `window.print()`。
- 自制 ZIP reader 只保证读取 Fusion Storyboard OS 输出的无压缩 Package，不支持任意第三方压缩 ZIP。
- UI 目前是英文；未来可以加入 bilingual 中文 / 英文切换。
- GitHub Pages 是公开静态站点，不要把客户项目或任何 Client Secret 提交到仓库。
