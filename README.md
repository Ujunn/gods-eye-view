# God's Eye View · 历史补丁存档工具

此工具会在已有本地 `~/Downloads/gods-eye-view` Git 仓库中，建立一个**独立的** `resilience-patch-history` 分支。它会逐一提交 12 个历史 ZIP：早期贸易演示、地球环绕、贸易控件，以及韧性实验室 v1～v8。

**注意区分：这些是当时发布的增量安装补丁，不是当时整个仓库的可运行完整源码快照。** 它们适合长期备份、阅读、提取代码或在符合条件的旧版本上按说明安装。它们不能被当作对 `agri-trade-2022` 的直接 `git checkout` 回退点。

## Mac 安装

将本 ZIP 解压至下载文件夹。确保 `gods-eye-view` 项目仍在 `~/Downloads/gods-eye-view`，并且已配置过 `ujunn` 远端。

```bash
cd ~/Downloads/gods-eye-view
bash ~/Downloads/gods-eye-version-history/publish.sh
```

脚本执行时会显示每次新增的文件，然后以 `git push` 将新分支和 v1～v8 的“补丁版本标签”推送到你的 GitHub。无需删除本地 ZIP 文件。旧的 `agri-trade-2022` 分支不变，未提交的本地工作也不变。

上传后：

- 历史补丁提交：https://github.com/Ujunn/gods-eye-view/commits/resilience-patch-history
- 版本标签：https://github.com/Ujunn/gods-eye-view/tags

标签采用 `resilience-patch-v1` 至 `resilience-patch-v8` 命名。每个标签对应的是**补丁存档版本**，而不是完整源代码的历史版本。

## 版本说明

| 版本 | 历史补丁 | 内容 |
|---|---|---|
| 早期原型 | gods-eye-rice-trade-demo.zip | 模拟水稻贸易线 |
| 正式贸易图 | gods-eye-agri-trade-2022.zip | FAOSTAT 四作物贸易层 |
| 镜头环绕 | gods-eye-earth-spin.zip | 环绕控制原型 |
| 图层控件 | gods-eye-controls-v2.zip | 贸易线显示数量等控件 |
| v1 | gods-eye-resilience-lab.zip | 大豆网络韧性攻击实验室 |
| v2 | gods-eye-resilience-v2.zip | 实线、染红、镜头和步长调整 |
| v3 | gods-eye-resilience-v3.zip | 简化颜色及右上角镜头控制 |
| v4 | gods-eye-resilience-v4.zip | 精细攻击滑块 |
| v5 | gods-eye-resilience-v5.zip | 红线闪烁修复 |
| v6 | gods-eye-resilience-v6.zip | 逐目标镜头跟拍 |
| v7 | gods-eye-resilience-v7.zip | 四作物韧性实验及宽视角 |
| v8 | gods-eye-resilience-v8.zip | 实验室紧凑布局和保留率位置调整 |

不含官方 FAOSTAT 大型原始数据包、`node_modules`、本机密钥、`.env` 文件或个人备份文件夹。
