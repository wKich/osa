## ADDED Requirements

### Requirement: Resolve prompt file mentions in the sandbox
The bridge SHALL answer `GET /api/fs/find` from the sandbox workdir's files,
ranked best match first and then by shorter path, and SHALL read a prompt's
`file://` attachment under the client's directory from the sandbox workdir,
attaching a text file or line range as `Attached file: <name>` text, a
directory as its listing, and an image as an image block. It SHALL NOT read
a host path, and SHALL drop an attachment outside the client's directory.

#### Scenario: A mentioned project file reaches Maki
- **WHEN** the user types `@note`, picks `notes.txt`, and sends the prompt
- **THEN** the transcript lists `notes.txt` under the prompt, and the child's
  `user` frame carries `Attached file: notes.txt` with its content

#### Scenario: A host path is never read
- **WHEN** a prompt attaches `file:///etc/hosts` from a client in another
  directory
- **THEN** nothing is read and the attachment is dropped
