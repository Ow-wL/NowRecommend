from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine

from app.config import get_settings
from app.models import UNMANAGED_TABLES, Base

config = context.config
if config.config_file_name is not None:
    # Keeps the loggers that exist already: the default turns every one of them off, so anything that migrates inside a
    # running process (the test suite, a script) would lose the app's own log lines from then on.
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def include_object(obj, name, type_, reflected, compare_to) -> bool:
    """Leaves operational tables (UNMANAGED_TABLES) out of the model comparison; everything else is compared."""
    return not (type_ == "table" and name in UNMANAGED_TABLES)


def run_migrations_offline() -> None:
    context.configure(url=get_settings().database_url, target_metadata=target_metadata, literal_binds=True, include_object=include_object)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(get_settings().database_url)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, include_object=include_object)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
