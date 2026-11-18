"""homescoop (slicc): awscrt.exceptions, the one name the AWS CLI imports.

The AWS CLI catches AwsCrtError around awscrt.crypto calls. The crypto here
(awscrt/crypto.py) raises RuntimeError on failure, as awscrt's native code
does, so nothing raises AwsCrtError; it exists for the
`except (AwsCrtError, RuntimeError)` clauses, with awscrt 0.38.1's
constructor and str().
"""


class AwsCrtError(Exception):
    def __init__(self, code, name, message):
        self.code = code
        self.name = name
        self.message = message

    def __repr__(self):
        return f"{type(self).__name__}(name={self.name!r}, message={self.message!r}, code={self.code})"

    def __str__(self):
        return f"{self.name}: {self.message}"
