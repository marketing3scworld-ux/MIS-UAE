# Stop the BME MIS PostgreSQL 16 service (requires admin).
Stop-Service bme-postgres
Get-Service bme-postgres | Select-Object Name, Status
