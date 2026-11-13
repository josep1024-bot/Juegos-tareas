# Juegos-tareas

App de tareas con análisis automático de dificultad (1-10) y sistema de puntos por cumplimiento de objetivos.

## Uso

Abre `index.html` en el navegador (app 100% estática, sin dependencias):

```bash
python3 -m http.server 8080
# → http://localhost:8080
```

## Funcionalidades

- Añadir tareas con título, descripción, duración, fecha límite, prioridad y categoría
- Análisis automático de dificultad 1-10 (duración, complejidad del texto, prioridad, plazo y categoría)
- Puntos = dificultad × 10, con bonos por plazo (+20% a tiempo, -20% retraso) y +15 en tareas de dificultad ≥ 8
- Niveles con barra de progreso y persistencia en localStorage
