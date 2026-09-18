Write-Host "Starting Chitragupta Local AI Backend..." -ForegroundColor Cyan
Set-Location -Path "$PSScriptRoot\backend"
python -m pip install -r requirements.txt
python run_server.py
