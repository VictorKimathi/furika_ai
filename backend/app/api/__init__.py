def register_namespaces(api):
    from .auth import ns as auth_namespace
    from .chat import chat_ns, chats_ns
    from .health import ns as health_namespace
    from .locations import ns as locations_namespace
    from .model_runs import ns as model_runs_namespace
    from .modelling import ns as modelling_namespace
    from .portfolios import ns as portfolios_namespace
    from .properties import ns as properties_namespace
    from .uploads import ns as uploads_namespace
    from .uploads import rows_ns as upload_rows_namespace

    for namespace in (
        health_namespace,
        auth_namespace,
        portfolios_namespace,
        properties_namespace,
        uploads_namespace,
        upload_rows_namespace,
        model_runs_namespace,
        modelling_namespace,
        locations_namespace,
        chat_ns,
        chats_ns,
    ):
        api.add_namespace(namespace)
