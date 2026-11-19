# Decisions

- Retain the existing pipeline and direct SDK calls. Splitting by UI feature would add deployments without creating independent workflows; the separate tool-free interpretation pipeline isolates model analysis from Auth0 access.
- Retain React Flow and the existing graph. States represent actual direct-request boundaries and local decisions, not engine traces.
- An offline fixture implements the same small tool-client interface. It exercises orchestration without network, model credentials or fabricated live events.
- Use field allowlists and validated response shapes. A failed check or empty page is not evidence that a condition does not exist. Model claims are not automatically verified.
- Do not persist customer data until isolation, retention and access control are demonstrated. This means refresh currently loses history.
