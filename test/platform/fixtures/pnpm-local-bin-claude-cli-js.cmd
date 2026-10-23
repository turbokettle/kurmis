@SETLOCAL
@IF EXIST "%~dp0\node.exe" (
  "%~dp0\node.exe"  "%~dp0\..\.pnpm\@anthropic-ai+claude-code@1.0.0\node_modules\@anthropic-ai\claude-code\cli.js" %*
) ELSE (
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node  "%~dp0\..\.pnpm\@anthropic-ai+claude-code@1.0.0\node_modules\@anthropic-ai\claude-code\cli.js" %*
)
