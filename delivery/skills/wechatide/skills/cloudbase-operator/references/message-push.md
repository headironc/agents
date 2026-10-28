# Message push and customer-service replies

Read this before binding a message type or an event to a cloud function, or before setting up a customer-service auto reply. The [cloudbase-operator entry](../SKILL.md) owns the operations and their confirmation rules; this reference covers only what those operations do not state.

## Routing key

DevTools routes a callback by the pair `(MsgType, Event)`:

| Category | `MsgType` | `Event` | Typical use |
| --- | --- | --- | --- |
| Message type | `text`, `image`, `voice`, `video`, `miniprogrampage` | empty string | A user's chat message or card sent to customer service |
| Event | `event` | A specific event name | Platform or business events, such as virtual-payment notifications |

One pair binds exactly one cloud function. Subscribing a pair that is already bound replaces the earlier function rather than adding to it, so read the current bindings with `cloud_query_msg_push --action list` and report what a subscribe would replace. Verify that the effective authorization covers that replacement; ask only when it does not.

Valid event names for `msg_type event` come from `cloud_query_msg_push --action listSupportedEvents`, which needs the AppID but no environment. Do not invent an event name. `--event-types` applies only to `msg_type event`; a message-type entry takes no event list. A `subscribe` for `msg_type event` with no `--event-types` defaults to the seven virtual-payment events, so pass the list explicitly when a narrower binding is meant.

## Push mode

| Mode | Behaviour |
| --- | --- |
| Cloud function, the default | Each `(MsgType, Event)` pair pushes to its own bound cloud function |
| Container | One cloud-hosting service receives everything on a single path, and the cloud-function callbacks stop taking effect |

`cloud_query_msg_push --action list` reports the current `pushMode`. In container mode `subscribe`, `unsubscribe` and `setEnable` are refused with a note to switch back to cloud-function mode first. This entry does not switch into container mode. `ensureCloudFunctionMode` is its only mode action, and `ensureContainerMode` and `setContainerCallback` are not delivered, because container mode disables every cloud-function callback and needs a cloud-hosting service and path that no delivered entry owns. Report a request for container mode as unavailable and name the DevTools cloud console instead.

`ensureCloudFunctionMode` is a write in the other direction: it moves the AppID back to cloud-function push, so a cloud-hosting service that was receiving every message stops receiving any. Read the current `pushMode` first, report what the switch would stop, and verify authorization for that AppID-wide effect under the entry's write rules. A subscription-only grant does not cover stopping the existing receiver.

## The receiving cloud function

Deploy the receiver with `cloud_fn_deploy` and `--remote-npm-install`, because its dependencies install in the cloud; without that flag a missing dependency usually surfaces at runtime as `Cannot find module`. The function directory's name is the function name.

A cloud function in push mode does not reply to the user by returning a value. A customer-service reply is sent actively through the OpenAPI call `customerServiceMessage.send`, which the function's own `config.json` must declare under `permissions.openapi`. Writing that function and its configuration is ordinary source work outside this entry, and deploying it is still a write requiring deployment authority. Reuse a task or batch grant that already covers that deployment.

Cloud-function logs are read in the DevTools cloud console, under the function's own log view. No delivered operation queries them, and no lower-level interface is used in their place.

## Verifying on a phone

Publishing a trial version or pushing a preview belongs to previewer: `upload` publishes the trial version and `auto_preview` pushes a preview into the developer's WeChat. A customer-service entry point in the Mini Program usually needs a `<button open-type="contact">`.

Upstream material names two invocations that this delivery does not accept. `miniprogram_upload` is an alias that the DevTools CLI resolves to `upload` internally; the call executor matches the literal operation name and refuses an alias as an undelivered operation. `-t TOOLNAME` selects the tool through the MCP bridge, and the executor reserves that option along with `-c` and `-a`. Use the delivered operation name as the executor's second argument instead.
