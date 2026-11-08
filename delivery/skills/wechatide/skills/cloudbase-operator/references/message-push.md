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

`cloud_query_msg_push --action list` reports the current `pushMode`. In container mode, `subscribe`, `unsubscribe` and `setEnable` are refused until the AppID switches back to cloud-function mode via `ensureCloudFunctionMode` (after reading `pushMode` and verifying authorization for stopping the existing container receiver as the [cloudbase-operator entry](../SKILL.md) requires). `ensureContainerMode` and `setContainerCallback` are not delivered; report container-mode setup requests as unavailable and direct the user to the DevTools cloud console.

## The receiving cloud function

A cloud function in push mode does not reply to the user by returning a value. A customer-service reply is sent actively through the OpenAPI call `customerServiceMessage.send`, which the function's own `config.json` must declare under `permissions.openapi`. Writing that function and its configuration is ordinary source work outside this entry, and deploying it via `cloud_fn_deploy --remote-npm-install` requires deployment authority under the [cloudbase-operator entry](../SKILL.md).

Cloud-function logs are read in the DevTools cloud console, under the function's own log view. No delivered operation queries them, and no lower-level interface is used in their place.

## Verifying on a phone

Publishing a trial version (`upload`) or pushing a preview (`auto_preview`) belongs to `previewer` (passing the registered operation ID rather than the `miniprogram_upload` alias or reserved `-t` flag). A customer-service entry point in the Mini Program usually needs a `<button open-type="contact">`.
