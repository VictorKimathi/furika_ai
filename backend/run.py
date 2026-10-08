import os

from dotenv import load_dotenv

load_dotenv()  # before importing the app: Config reads the environment at import time

from app import create_app  # noqa: E402


app = create_app()


if __name__ == "__main__":
    app.run(
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "5000")),
        debug=os.getenv("FLASK_DEBUG", "false").lower() == "true",
    )

