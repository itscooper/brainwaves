# 🧠 Brainwaves

Brainwaves is an intelligent profiling system designed to help educators understand and support learners through data-driven insights and personalized practice recommendations. The system collects structured profile data via online forms and provides targeted recommendations from educational frameworks.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/yourusername/brainwaves)

## Features

- Profile-based learner assessment
- Group management for organizing learners
- Automated practice recommendations
- Interactive data visualization
- Role-based access control
- Secure API backend
- Modern, responsive web interface

## Technology Stack

- **Backend**: FastAPI (Python) and FastAPI-Users
- **Database**: PostgreSQL with pgvector extension
- **Frontend**: HTML/JavaScript with Alpine.js
- **Styling**: Bulma CSS Framework
- **Containerization**: Docker & Docker Compose

## Local Development Setup

### Prerequisites

- Docker and Docker Compose
- Git


### Quick Start

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/brainwaves.git
   cd brainwaves
   ```

2. First time setup (initializes database with sample data):
   ```bash
   INIT_DB=true docker-compose up --build
   ```
   
   After initialization, look for the admin credentials in the terminal output and save them.

3. For subsequent runs:
   ```bash
   docker-compose up --build
   ```

### Configuration

The application uses several environment variables for configuration:

- `POSTGRES_USER`: Database username (default: postgres)
- `POSTGRES_DB`: Database name (default: fastapi_db)
- `POSTGRES_PASSWORD`: Database password (auto-generated if not provided)
- `INIT_DB`: Set to "true" to initialize database with sample data
- `DOCKER_FILE`: Specify which Dockerfile to use (default: Dockerfile)

Environment variables can be set in a `.env` file or passed directly to docker-compose. .env is generated automatically with a random database password if it does not already exist.

### Accessing the Application

- **Web Interface**: http://localhost:8000/c/
- **API Documentation**: http://localhost:8000/docs/
- **Admin Interface**: http://localhost:8000/c/admin/

## Project Structure

```
brainwaves/
├── fastapi/              # Backend API service
│   ├── api/             # API implementation
│   │   ├── models.py    # Database models
│   │   └── main.py      # FastAPI application
│   └── client/          # Frontend web application
├── docker-compose.yml    # Docker services configuration
```

## Security

- Passwords are hashed using bcrypt
- JWT tokens are used for API authentication
- Database passwords are automatically generated and securely stored

## License

This project is licensed under the GNU AGPLv3 License - see the [LICENSE](LICENSE) file for details.

## Acknowledgements

- [FastAPI](https://fastapi.tiangolo.com/) - Modern Python web framework
- [Alpine.js](https://alpinejs.dev/) - Lightweight JavaScript framework
- [Bulma](https://bulma.io/) - Modern CSS framework
- [Chart.js](https://www.chartjs.org/) - JavaScript charting library

## Contact

- Project maintainers: [Chris Cooper](https://github.com/itscooper/)