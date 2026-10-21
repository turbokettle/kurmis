@SETLOCAL
@IF NOT DEFINED NODE_PATH (
  @SET "NODE_PATH=C:\Users\example\AppData\Local\pnpm\global\v11\50d858e0985ecc7f60418aaf0cc5ab587f42c2570a884095a9e8ccacd0f6545c\node_modules\.pnpm\node_modules"
) ELSE (
  @SET "NODE_PATH=C:\Users\example\AppData\Local\pnpm\global\v11\50d858e0985ecc7f60418aaf0cc5ab587f42c2570a884095a9e8ccacd0f6545c\node_modules\.pnpm\node_modules;%NODE_PATH%"
)
@"%~dp0\global\v11\50d858e0985ecc7f60418aaf0cc5ab587f42c2570a884095a9e8ccacd0f6545c\node_modules\@anthropic-ai\claude-code\bin\claude.exe"   %*
