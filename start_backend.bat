@echo off
echo Starting Chitragupta Local AI Backend...
cd /d "%~dp0backend"
python -m pip install -r requirements.txt
python run_server.py
pause
