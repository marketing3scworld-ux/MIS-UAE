# BME MIS PostgreSQL 16 runs as the auto-start Windows service "bme-postgres"
# (data dir D:\pgdata, port 5433), so it comes up automatically on boot and you
# normally never need this. To start it manually (requires admin):
Start-Service bme-postgres
Get-Service bme-postgres | Select-Object Name, Status, StartType
