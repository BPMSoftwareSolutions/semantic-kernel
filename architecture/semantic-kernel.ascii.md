# Semantic Kernel

```text
Canonical semantic packs
        |
        v
+----------------------------+
| Semantic Catalog           |
| decisions / projections    |
| iterations / executions    |
+-------------+--------------+
              |
              v
+----------------------------+       declared port identity
| Domain-neutral Kernel      |--------------------------------+
| predicate evaluation       |                                |
| decision resolution        |                                v
| data projection            |                  +----------------------------+
| iteration / sequencing     |                  | Mechanical Port Registry   |
+-------------+--------------+                  | filesystem / HTTP / DB     |
              |                                 +-------------+--------------+
              +-----------------------+-----------------------+
                                      v
                        +----------------------------+
                        | Execution Receipt          |
                        | steps / observations       |
                        | result / failure           |
                        +----------------------------+

Consumer semantic authority
        |
        v
+----------------------------+
| Consumer Code Projector    |  owns language, framework,
| registered by identity     |  mechanics, and body layout
+-------------+--------------+
              |
              v
+----------------------------+
| Kernel projection boundary |
| immutable inputs           |
| artifact/path validation   |
| deterministic SHA-256      |
+-------------+--------------+
              |
              v
+----------------------------+
| Code Projection Receipt    |
| target / artifacts / hashes|
+-------------+--------------+
              |
              v
+----------------------------+
| Generic packaged CLI       |
| load / write / check only  |
+----------------------------+
```

The kernel never supplies an application body. Each consumer's registered
projector determines the generated source and artifact layout.
