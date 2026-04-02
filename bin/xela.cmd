@echo off
setlocal

set "XELA_HOME=%USERPROFILE%\.xela"
set "XELA_CONFIG=%XELA_HOME%\config.cmd"
set "INSTALL_DIR=%~dp0.."

:: Create config on first run
if not exist "%XELA_CONFIG%" (
  mkdir "%XELA_HOME%" 2>nul
  (
    echo @echo off
    echo :: Xela Configuration
    echo :: Provider: openrouter, groq, ollama, deepseek, openai, cerebras, sambanova
    echo set "XELA_PROVIDER=openrouter"
    echo.
    echo :: API Key
    echo set "OPENAI_API_KEY=sk-or-your-key-here"
    echo.
    echo :: Model ^(auto-detected from provider if not set^)
    echo :: set "OPENAI_MODEL=qwen/qwen3.6-plus-preview:free"
    echo.
    echo :: Base URL ^(auto-detected from provider if not set^)
    echo :: set "OPENAI_BASE_URL=https://openrouter.ai/api/v1"
  ) > "%XELA_CONFIG%"
  echo.
  echo   Welcome to Xela!
  echo   Config created at %XELA_CONFIG%
  echo   Edit it: notepad %XELA_CONFIG%
  echo.
)

:: Load config
call "%XELA_CONFIG%"

:: Auto-detect base URL
if not defined OPENAI_BASE_URL (
  if "%XELA_PROVIDER%"=="openrouter" set "OPENAI_BASE_URL=https://openrouter.ai/api/v1"
  if "%XELA_PROVIDER%"=="groq" set "OPENAI_BASE_URL=https://api.groq.com/openai/v1"
  if "%XELA_PROVIDER%"=="ollama" set "OPENAI_BASE_URL=http://localhost:11434/v1"
  if "%XELA_PROVIDER%"=="deepseek" set "OPENAI_BASE_URL=https://api.deepseek.com"
  if "%XELA_PROVIDER%"=="cerebras" set "OPENAI_BASE_URL=https://api.cerebras.ai/v1"
  if "%XELA_PROVIDER%"=="sambanova" set "OPENAI_BASE_URL=https://api.sambanova.ai/v1"
)

:: Auto-detect model
if not defined OPENAI_MODEL (
  if "%XELA_PROVIDER%"=="openrouter" set "OPENAI_MODEL=qwen/qwen3.6-plus-preview:free"
  if "%XELA_PROVIDER%"=="groq" set "OPENAI_MODEL=qwen-qwq-32b"
  if "%XELA_PROVIDER%"=="ollama" set "OPENAI_MODEL=qwen2.5-coder:7b"
  if "%XELA_PROVIDER%"=="deepseek" set "OPENAI_MODEL=deepseek-chat"
  if "%XELA_PROVIDER%"=="openai" set "OPENAI_MODEL=gpt-4o"
  if "%XELA_PROVIDER%"=="cerebras" set "OPENAI_MODEL=llama-3.3-70b"
  if "%XELA_PROVIDER%"=="sambanova" set "OPENAI_MODEL=Meta-Llama-3.3-70B-Instruct"
)

:: Handle -m flag
:parse_args
if "%~1"=="-m" (
  set "OPENAI_MODEL=%~2"
  shift
  shift
  goto :parse_args
)
if "%~1"=="--model" (
  set "OPENAI_MODEL=%~2"
  shift
  shift
  goto :parse_args
)

node --import "%INSTALL_DIR%\src\_shims\register.js" "%INSTALL_DIR%\start.js" %*
