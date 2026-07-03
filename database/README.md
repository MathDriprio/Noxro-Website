# Database

- PostgreSQL
- Migrations uniquement
- Aucune modification directe de la base

## Ordre

001 → Users

002 → Vehicles

003 → UserVehicles

...

## Règles

- Une migration = une tâche
- Une migration validée n'est jamais modifiée
- Toute évolution passe par une nouvelle migration