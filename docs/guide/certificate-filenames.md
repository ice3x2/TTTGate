# Certificate filenames

Certificate key, certificate and CA names must be plain basenames within the
configured administrator or external-certificate directory. Existing Unicode,
interior spaces, hyphens and dots are supported. An empty optional CA uses an
empty name and value; nonempty PEM content requires a filename.

Names containing directory separators, drive/stream separators, control characters,
reserved Windows punctuation, trailing dots/spaces or reserved device/console
aliases are rejected with HTTP 400. Names are not silently shortened or rewritten.
Existing authentication, CSRF and certificate revision requirements still apply.

If an older certificate index contains an unsafe name, certificate changes that
would access its PEM paths are rejected; metadata can still be read. Back up and correct
the stored metadata while the service is stopped, using actual files inside the
certificate directories. The application does not automatically move or delete
files referenced outside those directories.
