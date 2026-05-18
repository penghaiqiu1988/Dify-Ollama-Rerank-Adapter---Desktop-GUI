@echo off
chcp 65001 >nul
echo ========================================
echo  Dify Ollama Rerank Adapter - 构建脚本
echo ========================================
echo.

:: 检查 Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js (https://nodejs.org/)
    pause
    exit /b 1
)

echo [信息] Node.js 版本:
node -v
echo.

:: ======== 设置国内镜像（解决 SSL 和下载慢的问题）========
echo [信息] 配置国内镜像源...
call npm config set ELECTRON_MIRROR https://npmmirror.com/mirrors/electron/
call npm config set ELECTRON_BUILDER_BINARIES_MIRROR https://npmmirror.com/mirrors/electron-builder-binaries/

:: 如果上面的镜像不行，取消下面这行的注释来跳过 SSL 验证
:: set NODE_TLS_REJECT_UNAUTHORIZED=0

:: ======== 清理旧依赖（解决 EPERM 权限问题）========
echo.
echo [提示] 如果之前安装失败，建议先手动删除 node_modules 文件夹
echo        然后按任意键继续安装...
pause

:: ======== 安装依赖 ========
echo.
echo [1/3] 安装依赖（使用国内镜像）...
call npm install --use-system-ca
if %ERRORLEVEL% neq 0 (
    echo.
    echo [备选] 首次安装失败，尝试跳过 SSL 验证...
    set NODE_TLS_REJECT_UNAUTHORIZED=0
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo [错误] 依赖安装失败
        echo.
        echo 请尝试以下步骤：
        echo   1. 删除 node_modules 文件夹
        echo   2. 删除 package-lock.json 文件
        echo   3. 以管理员身份运行此脚本
        echo   4. 或手动执行: set NODE_TLS_REJECT_UNAUTHORIZED=0 ^& npm install
        pause
        exit /b 1
    )
)
echo.

:: ======== 构建 Windows exe ========
echo [2/3] 构建 Windows 安装包...
call npx electron-builder --win --x64
if %ERRORLEVEL% neq 0 (
    echo [错误] 构建失败
    pause
    exit /b 1
)
echo.

echo [3/3] 构建完成！
echo.
echo 输出位置:
dir /b dist\*.exe 2>nul
echo.
echo   便携版直接双击运行，安装版需安装后使用。
echo.
pause
