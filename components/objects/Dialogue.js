const mongo = require("../apis/mongo.js");
const otherFunctions = require("../common_functions.js");
const awsApi = require("../apis/AWS_API.js")
const msqTemplates = require("../../config/telegramMsgTemplates");
const Completion = require("./Completion.js");
const devPrompts = require("../../config/developerPrompts.js");
const modelConfig = require("../../config/modelConfig.js");
const { error } = require("pdf-lib");
const openAIApi = require("../apis/openAI_API.js");
const { chat } = require("../../config/telegramModelsSettings.js");

class Dialogue {

    //instances
    #user;
    #userid;
    #replyMsg;
    #requestMsg;
    #completionInstance;
    #metaObject
    #defaultMetaObject = {
        userid: this.#userid,
        server_errors_count: 0,
        total_tokens: 0,
        image_input_bites: 0,
        image_input_count: 0,
        image_input_limit_exceeded: false,
        pdf_input_bites: 0,
        pdf_input_pages: 0,
        pdf_input_limit_exceeded: false,
        function_calls: {
            inProgress: false,
            failedRuns: {},
            mdjButtonsShown: [],
            mdjSeed: String(Math.floor(Math.random() * 100000000))
        },
        oai_storage_files_in_progress: {}
    };

    #regenerateCompletionFlag;

    constructor(obj) {
        this.#user = obj.userInstance;
        this.#userid = this.#user.userid;
        this.#replyMsg = obj.replyMsgInstance;
        this.#requestMsg = obj.requestMsgInstance;

    };

    async triggerCallCompletion() {

        await this.#user.getUserProfileFromDB()
        await this.getMetaFromDB()

        if (this.anyFunctionInProgress) {
            const userMsgText = otherFunctions.getLocalizedPhrase(`function_in_progress`, this.#user.language)
            await this.#replyMsg.sendToNewMessage(userMsgText, null, null)
            return;
        }

        this.#completionInstance = new Completion({
            requestMsg: this.#requestMsg,
            replyMsg: this.#replyMsg,
            userClass: this.#user,
            dialogueClass: this
        })

        // this.deleteRegenerateButton() //made async on purpose

        await this.#completionInstance.router()
    }

    async getLastCompletionDoc() {

        const lastCompletionDoc = await mongo.getLastCompletion(this.#user.userid, this.#user.currentRegime)
        return lastCompletionDoc
    };

    async getDialogueForRequest(model, regime) {
        const image_size_limit = modelConfig[model]?.image_input_limit_bites ?? 1024 * 1024
        const image_count_limit = modelConfig[model]?.image_input_limit_count ?? 5
        const canUseReasoning = modelConfig[model]?.canUseReasoning ?? false
        const dialogueFromDB = await mongo.getDialogueFromDB(this.#user.userid, this.#user.currentRegime) || []
        const dialogueWoExpired = dialogueFromDB.filter(doc => !doc.expires_at || doc.expires_at > new Date())
        const dialogueFilteredByReasoning = this.reasoningInputFileter(dialogueWoExpired, canUseReasoning)
        const dialogueFilteredByImageLimit = this.imageInputFilter(dialogueFilteredByReasoning, image_size_limit, image_count_limit)
        const mappedDialogue = this.mapValuesToDialogue(dialogueFilteredByImageLimit);
        
        const dateTimePrompt = await this.dateTimeSystemPromptForDialogue();
        const initialPrompt = await this.initialSystemPromptForDialogue(regime);
        const mcpPrompts = await this.mcpToolsSystemPromptForDialogue(regime);
        
        otherFunctions.saveTextToTempFile( JSON.stringify([initialPrompt, dateTimePrompt,...mcpPrompts, ...mappedDialogue], null, 2),"dialogueForRequest.json")
        otherFunctions.saveTextToTempFile( JSON.stringify(mappedDialogue, null, 2),"dialogueFromDB.json")
        return [initialPrompt, dateTimePrompt,...mcpPrompts, ...mappedDialogue]
    };

    async getDialogueForSearch(function_call_id, model) {

        const search_model_max_input_tokens = modelConfig[model]?.search_length_limit_in_tokens || 100_000
        const image_size_limit = modelConfig[model]?.image_input_limit_bites ?? 1024 * 1024
        const image_count_limit = modelConfig[model]?.image_input_limit_count ?? 5

        const dialogueFromDB = await mongo.getDialogueFromDB(this.#user.userid, this.#user.currentRegime) || []
        const dialogueFiltereByFunctionCall = dialogueFromDB.filter(doc => !doc.tool_call_id || doc.tool_call_id !== function_call_id)
        const dialogueFiltereBySearchFlag = dialogueFiltereByFunctionCall.filter(doc => doc.includeInSearch)
        const dialogueFilteredByImageLimit = this.imageInputFilter(dialogueFiltereBySearchFlag, image_size_limit, image_count_limit)
        const dialogueFilteredByTokenLimit = this.tokenFilterForSearch(dialogueFilteredByImageLimit, search_model_max_input_tokens)
        const mappedDialogue = this.mapValuesToDialogue(dialogueFilteredByTokenLimit);

        const dateTimePrompt = await this.dateTimeSystemPromptForDialogue();

        return [dateTimePrompt, ...mappedDialogue];
    };

    mapValuesToDialogue(dialogue) {

        return dialogue.map(doc => {
            const { role,
                content,
                status,
                type,
                function_name,
                tool_call_id,
                function_arguments,
                mcp_tool_call_id,
                mcp_tools,
                mcp_server_label,
                mcp_error,
                mcp_approval_request_id,
                mcp_call_name,
                mcp_call_arguments,
                mcp_approval_response_id,
                mcp_call_approve,
                mcp_call_user_response_reason,
                mcp_call_id,
                mcp_call_error,
                mcp_call_output,
                image_id,
                image_result_base64,
                reasoning_id,
                reasoning_encrypted_content,
                reasoning_summary,
                code_id,
                code_container_id,
                code,
                outputs
            } = doc;

            if (type === "message") {
                return { role, status, type, content };
            } else if (type === "function_call_output") {
                return {
                    type,
                    call_id: tool_call_id,
                    output: content
                }
            } else if (type === "reasoning") {
                return {
                    type,
                    id: reasoning_id,
                    encrypted_content:reasoning_encrypted_content,
                    summary: reasoning_summary
                }
            } else if (type === "function_call") {
                return {
                    type,
                    call_id: tool_call_id,
                    name: function_name,
                    arguments: function_arguments
                }
            } else if (type === "image_generation_call") {
                return {
                    type,
                    id: image_id,
                    status: status,
                    result: image_result_base64
                }
            } else if (type === "code_interpreter_call") {
                return {
                    type,
                    id: code_id,
                    status: status,
                    container_id: code_container_id,
                    code: code,
                    outputs: outputs
                }
            
            } else if (type === "mcp_list_tools") {
                return {
                    type,
                    id: mcp_tool_call_id,
                    server_label: mcp_server_label,
                    tools: mcp_tools,
                    error: mcp_error
                }
            } else if (type === "mcp_approval_request") {
                return {
                    type,
                    id: mcp_approval_request_id,
                    server_label: mcp_server_label,
                    name: mcp_call_name,
                    arguments: mcp_call_arguments
                }
            } else if (type === "mcp_approval_response") {
                return {
                    type,
                    id: mcp_approval_response_id,
                    approval_request_id: mcp_approval_request_id,
                    approve: mcp_call_approve,
                    reason: mcp_call_user_response_reason
                }
            } else if (type === "mcp_call") {
                return {
                    type,
                    id: mcp_call_id,
                    server_label: mcp_server_label,
                    name: mcp_call_name,
                    arguments: mcp_call_arguments,
                    error: mcp_call_error,
                    output: mcp_call_output
                }
            } else {
                return null
            }
        }).filter(doc => doc !== null);
    }

    reasoningInputFileter(dialogue, canUseReasoning) {

        if (canUseReasoning) {
            return dialogue
        } else {
            return dialogue.filter(item => item.type != "reasoning")
        }
    }


    imageInputFilter(dialogue, image_size_limit, image_count_limit) {

        const filteredDialogue = [];
        let imageSize = 0;
        let imageCount = 0;
        let image_input_limit_exceeded = false;

        for (let i = dialogue.length - 1; i >= 0; i--) {

            const document = dialogue[i];
            const { image_size_bites, image_input } = document;
            if (image_input) {
                if (!image_input_limit_exceeded) {
                    if (imageCount + 1 > image_count_limit || imageSize + image_size_bites > image_size_limit) {
                        image_input_limit_exceeded = true
                        continue; // Skip if image input exceeds limit
                    } else {
                        filteredDialogue.unshift(document);
                        imageCount += 1;
                        imageSize += image_size_bites || 0;
                    }
                }
            } else {
                filteredDialogue.unshift(document);
            }
        }

        return filteredDialogue
    }

    tokenFilterForSearch(dialogue, token_limit) {

        const filteredInput = [];
        let totalTokens = 0;

        for (let i = dialogue.length - 1; i >= 0; i--) {
            const document = dialogue[i];
            const documentTokens = document.tokens || 0;

            // Check if adding this document would exceed the limit
            if (totalTokens + documentTokens <= token_limit) {
                filteredInput.unshift(document); // Add to beginning to maintain order
                totalTokens += documentTokens;
            } else {
                break; // Stop adding documents
            }
        }
        return filteredInput
    }

    get completionInstance() {
        return this.#completionInstance
    }

    get userInstance() {
        return this.#user
    }

    set regenerateCompletionFlag(value) {
        this.#regenerateCompletionFlag = value;
    }

    get regenerateCompletionFlag() {
        return this.#regenerateCompletionFlag;
    }

    async deleteAllInlineButtons() {

        let lastTgmMsgIdsFromCompletions = new Set();

        const [documentsWithBtns, tempReplyMarkup] = await Promise.all([
            mongo.getDocByTgmBtnsFlag(this.#user.userid, this.#user.currentRegime),
            mongo.getTempReplyMarkup(this.#user.userid)
        ])

        documentsWithBtns.length > 0 && documentsWithBtns.forEach(doc => {
            if (doc.telegramMsgId && Array.isArray(doc.telegramMsgId) && doc.telegramMsgId.length > 0) {
                lastTgmMsgIdsFromCompletions.add(doc.telegramMsgId.at(-1));
            }
        });

        tempReplyMarkup.length > 0 && tempReplyMarkup.forEach(doc => {
            if (doc.messageId) {
                lastTgmMsgIdsFromCompletions.add(doc.messageId);
            }
        });

        if (lastTgmMsgIdsFromCompletions.size === 0) {
            return
        }

        for (const msgId of lastTgmMsgIdsFromCompletions) {
            try {
                const reply_markup = { one_time_keyboard: true, inline_keyboard: [] };
                await this.#replyMsg.updateMessageReplyMarkup(msgId, reply_markup)
            } catch (err) {
                console.log("Error in deleteAllInlineButtons", err.message)
            }
        }
        await mongo.deleteTempReplyMarkup(this.#user.userid)
    }


    async deleteRegenerateButton() {

        if (this.regenerateCompletionFlag) {
            return
        }

        const documentsWithRegenerateBtns = await mongo.getDocByTgmRegenerateBtnFlag(this.#user.userid, this.#user.currentRegime)


        if (documentsWithRegenerateBtns.length === 0) {
            return
        }

        for (const doc of documentsWithRegenerateBtns) {

            const { sourceid, telegramMsgReplyMarkup, telegramMsgId } = doc;
            if (telegramMsgId && Array.isArray(telegramMsgId) && telegramMsgId.length > 0) {

                let newInlineKeyboard = [];
                telegramMsgReplyMarkup.inline_keyboard.forEach(row => {
                    const newRow = row.filter(button => button.text !== "🔄");
                    newInlineKeyboard.push(newRow);
                })
                telegramMsgReplyMarkup.inline_keyboard = newInlineKeyboard;

                try {
                    await Promise.all([
                        this.#replyMsg.updateMessageReplyMarkup(telegramMsgId.at(-1), telegramMsgReplyMarkup),
                        mongo.updateCompletionInDb({
                            filter: { sourceid: sourceid },
                            updateBody: { telegramMsgRegenerateBtns: false, telegramMsgReplyMarkup: telegramMsgReplyMarkup }
                        })])
                } catch (err) {
                    console.log("Error in deleteAllInlineButtons", err.message)
                }

            }
        };
    }


    async deleteOAIFilesFromStorageByFileIds(fileids) {

        const deletePromises = fileids.map(fileid => (async () => {
            try {
                const result = await openAIApi.deleteFile(fileid);
                return result;
            } catch (err) {
                return { error: err.message };
            };
        })());

        const result = await Promise.all(deletePromises);
        const deleteResults = result.filter(res => res.deleted);

        return { filesCount: fileids.length, deletedCount: deleteResults.length }
    };

    async deleteOAIFilesFromStorage(oaiStorageFiles) {

        const deletePromises = oaiStorageFiles.map(file => (async () => {
            const { resourceData: { OAIStorage: { fileId } } } = file;
            try {
                const result = await openAIApi.deleteFile(fileId);
                return result;
            } catch (err) {
                return { error: err.message };
            };
        })());

        const result = await Promise.all(deletePromises);
        const deleteResults = result.filter(res => res.deleted);

        return { filesCount: oaiStorageFiles.length, deletedCount: deleteResults.length }
    }

    async resetAllDialogues() {

        const userIds = await mongo.getUniqueUserIdsFromDialogs() || [];;
        let textResult = `Команда затронула ${userIds.length} пользователей:`
        console.log("Unique user IDs from dialogs:", userIds);

        const delete_s3_files_promise = (async () => {
            let countDeleted = 0;
            for (const userid of userIds) {
                const result = await awsApi.deleteS3FilesByPefix(otherFunctions.valueToMD5(String(userid)), "");
                const deletedCount = Array.isArray(result?.Deleted) ? result.Deleted.length : (result?.Deleted ?? 0);
                countDeleted += deletedCount;
            }
            return countDeleted;
        })();

        const {data:OAIStorageFiles} = await openAIApi.listFiles();

        const oaiFilesToDeletePromise = (async () => {
            let countDeleted = 0;
            for (const file of OAIStorageFiles) {
                const result = await openAIApi.deleteFile(file.id);
                const deletedCount = result?.deleted ? 1 : 0;
                countDeleted += deletedCount;
            };
            return countDeleted;
        })();

        const [
            dialoguesDetetionResult,
            tempResourcesDetetionResult,
            outputDocumentsDetetionResult,
            dropDialogueMetaCollectionResult,
            deleteS3Count,
            deleteOAIStorageCount
        ] = await Promise.all([
            mongo.dropDialogCollection(),
            mongo.dropTempResourceStorageCollection(),
            mongo.dropOutputDocumentCollection(),
            mongo.dropDialogueMetaCollection(),
            delete_s3_files_promise,
            oaiFilesToDeletePromise
        ]);

        if (dialoguesDetetionResult.dropped) {
            textResult += `\n✅ удалены все диалоги`
        } else {
            textResult += `\n❌ не удалось удалить диалоги: ${dialoguesDetetionResult.reason}`
        };

        if (tempResourcesDetetionResult.dropped) {
            textResult += `\n✅ удалены все записи из временного хранилища ресурсов`
        } else {
            textResult += `\n❌ не удалось удалить записи из временного хранилища ресурсов: ${tempResourcesDetetionResult.reason}`
        };

        if (outputDocumentsDetetionResult.dropped) {
            textResult += `\n✅ удалены все записи из временного хранилища результатов`
        } else {
            textResult += `\n❌ не удалось удалить записи из временного хранилища результатов: ${outputDocumentsDetetionResult.reason}`
        };

        if (dropDialogueMetaCollectionResult.dropped) {
            textResult += `\n✅ удалены все записи метаданных диалогов`
        } else {
            textResult += `\n❌ не удалось удалить записи метаданных диалогов: ${dropDialogueMetaCollectionResult.reason}`
        };

        if (deleteS3Count > 0) {
            textResult += `\n✅ удалены все файлы из хранилища S3: ${deleteS3Count} файлов.`
        } else {
            textResult += `\n✅ проверено хранилище S3: файлов для удаления не найдено.`
        };

        if(deleteOAIStorageCount > 0){
            textResult += `\n✅ удалены все файлы из хранилища OAI: ${deleteOAIStorageCount} файлов.`
        } else {
            textResult += `\n✅ проверено хранилище OAI: файлов для удаления не найдено.`
        }
        return { text: textResult }
    };

    async resetDialogue() {

        const agent = this.#user.currentRegime;
        const oaiStorageFiles = await mongo.getOAIStorageFiles(this.#userid, agent) || [];

        const [
            deleteAllInlineButtonsResult,
            deleteDialogByUserPromiseResult,
            deleteTempStorageByUserIdResult,
            deleteOutputStorageByUserIdResult,
            deleteS3FilesByPefixResult,
            deleteS3Results,
            deleteOAIFilesFromStorageResults,
            deleteMetaResult] = await Promise.all(
                [
                    this.deleteAllInlineButtons(),
                    mongo.deleteDialogByUserPromise([this.#userid], "chat"),
                    mongo.deleteTempStorageByUserIdAndAgent(this.#userid, agent),
                    mongo.deleteOutputStorageByUserIdAndAgent(this.#userid, agent),
                    awsApi.deleteS3FilesByPefix(this.#userid, this.#user.currentRegime), //to delete later
                    awsApi.deleteS3FilesByPefix(otherFunctions.valueToMD5(String(this.#userid)), this.#user.currentRegime),
                    this.deleteOAIFilesFromStorage(oaiStorageFiles),
                    this.deleteMeta()
                ]);
        const deletedFiles = deleteS3Results.Deleted;
        await this.createMeta()

        const buttons = {
            reply_markup: {
                keyboard: [['Перезапустить диалог']],
                resize_keyboard: true,
                one_time_keyboard: false
            }
        };

        if (deletedFiles) {
            return { text: msqTemplates.dialogresetsuccessfully_extended.replace("[files]", deletedFiles.length), buttons: buttons };
        } else {
            return { text: msqTemplates.dialogresetsuccessfully, buttons: buttons };
        }
    }

    async getMetaFromDB() {
        this.#metaObject = await mongo.readDialogueMeta(this.#userid)

        if (this.#metaObject === null) {
            await this.createMeta()
        }
        return this.#metaObject
    }

    async deleteMeta() {
        const result = await mongo.deleteDialogueMeta(this.#userid)
        this.#metaObject = this.#defaultMetaObject
    }

    async createMeta() {
        this.#metaObject = this.#defaultMetaObject
        this.#metaObject.userid = this.#userid
        await mongo.createDialogueMeta(this.#metaObject)
    }

    async metaIncrementImageInput(size_bites = 0, image_count = 0) {

        this.#metaObject.image_input_bites += size_bites;
        this.#metaObject.image_input_count += image_count;

        await mongo.updateDialogueMeta(this.#userid, this.#metaObject)
        return {
            image_input_bites: this.#metaObject.image_input_bites,
            image_input_count: this.#metaObject.image_input_count
        }
    }

    async metaIncrementPdfInput(size_bites = 0, size_pages = 0) {

        this.#metaObject.pdf_input_bites += size_bites;
        this.#metaObject.pdf_input_pages += size_pages;

        await mongo.updateDialogueMeta(this.#userid, this.#metaObject)
        return {
            pdf_input_bites: this.#metaObject.pdf_input_bites,
            pdf_input_pages: this.#metaObject.pdf_input_pages
        }
    }

    async metaImageInputLimitExceeded() {
        this.#metaObject.image_input_limit_exceeded = true;
        await mongo.updateDialogueMeta(this.#userid, this.#metaObject)
        return this.#metaObject.image_input_limit_exceeded
    }

    async metaOAIStorageFileUploadStarted(msgid) {
        if (!this.#metaObject.oai_storage_files_in_progress) {
            this.#metaObject.oai_storage_files_in_progress = {};
        }
        const msgidStr = String(msgid)
        this.#metaObject.oai_storage_files_in_progress[msgidStr] = true;
        await mongo.updateDialogueMeta(this.#userid, this.#metaObject)
    };

    async metaOAIStorageFileUploadCompleted(msgid) {

        const msgidStr = String(msgid)
        
        const data = {};
        data[`oai_storage_files_in_progress.${msgidStr}`] = false;

        if (!this.#metaObject.oai_storage_files_in_progress) {
            this.#metaObject.oai_storage_files_in_progress = {};
        };
        this.#metaObject.oai_storage_files_in_progress[msgidStr] = false;
        await mongo.updateDotNotationDialogueMeta(this.#userid, data)
        await this.getMetaFromDB();
    }

    async metaOAIStorageFilesUploadInProgress() {
        await this.getMetaFromDB();
        const filesInProgress = Object.values(this.#metaObject?.oai_storage_files_in_progress || {}).filter(status => status === true)
        return filesInProgress.length > 0
    }

    async metaPdfInputLimitExceeded() {
        this.#metaObject.pdf_input_limit_exceeded = true;
        await mongo.updateDialogueMeta(this.#userid, this.#metaObject)
        return this.#metaObject.pdf_input_limit_exceeded
    }

    get image_input_limit_exceeded() {
        return this.#metaObject.image_input_limit_exceeded
    }

    async metaIncrementFailedFunctionRuns(functionName) {

        if (this.#metaObject.function_calls?.failedRuns && this.#metaObject.function_calls.failedRuns[functionName] > 0) {
            this.#metaObject.function_calls.failedRuns[functionName] += 1;
        } else {
            if (!this.#metaObject.function_calls) {
                this.#metaObject.function_calls = {};
            }
            if (!this.#metaObject.function_calls.failedRuns) {
                this.#metaObject.function_calls.failedRuns = {}
            }
            this.#metaObject.function_calls.failedRuns[functionName] = 1;
        }
        await mongo.updateDialogueMeta(this.#userid, this.#metaObject)
        return this.#metaObject.function_calls.failedRuns[functionName]
    }

    async metaResetFailedFunctionRuns(functionName) {

        if (this.#metaObject.function_calls?.failedRuns && this.#metaObject.function_calls.failedRuns[functionName] > 0) {
            delete this.#metaObject.function_calls.failedRuns[functionName]
            await mongo.updateDialogueMeta(this.#userid, this.#metaObject)
        }
    }

    async incrementServerErrorsCount() {
        if(!this.#metaObject.server_errors_count){
            this.#metaObject.server_errors_count = 0
        }
        this.#metaObject.server_errors_count += 1
        await mongo.updateDialogueMeta(this.#userid, this.#metaObject)
        return this.#metaObject.server_errors_count
    }

    async clearServerErrorsCount() {
        this.#metaObject.server_errors_count = 0
        await mongo.updateDialogueMeta(this.#userid, this.#metaObject)
    }

    get server_errors_count() {
        return this.#metaObject.server_errors_count || 0
    }

    async metaUpdateTotalTokens(tokens = 0) {
        this.#metaObject.total_tokens = tokens
        await mongo.updateDialogueMeta(this.#userid, this.#metaObject)
    }

    async metaGetTotalTokens() {
        const result = await mongo.readDialogueMeta(this.#userid)

        this.#metaObject.total_tokens = result.total_tokens || 0;
        return this.#metaObject.total_tokens
    }

    metaGetNumberOfFailedFunctionRuns(functionName) {
        if (this.#metaObject.function_calls?.failedRuns && this.#metaObject.function_calls.failedRuns[functionName] > 0) {
            return this.#metaObject.function_calls.failedRuns[functionName]
        } else {
            return 0
        }
    }

    get metaGetMdjButtonsShown() {
        return this.#metaObject.function_calls.mdjButtonsShown
    }

    async metaSetMdjButtonsShown(mdjButtonsArray) {
        let buttonsAdded = 0;
        mdjButtonsArray.forEach(value => {
            if (!this.#metaObject.function_calls.mdjButtonsShown.includes(value)) {
                this.#metaObject.function_calls.mdjButtonsShown.push(value);
                buttonsAdded += 1
            }
        });

        if (buttonsAdded > 0) {
            await mongo.updateDialogueMeta(this.#userid, this.#metaObject)
        };
        return buttonsAdded
    }

    async metaSetAllFunctionsInProgressStatus(value) {
        this.#metaObject.function_calls.inProgress = value;
        await mongo.updateDialogueMeta(this.#userid, this.#metaObject)
    }

    get anyFunctionInProgress() {
        return this.#metaObject?.function_calls?.inProgress || false
    }

    get mdjSeed() {
        return this.#metaObject.function_calls?.mdjSeed || 0
    }

    async commitExtractedTextToDialogue(text, resourceId) {
        const datetime = new Date();

        const sourceid = otherFunctions.valueToMD5(datetime.toISOString()) + `extracted_content_${resourceId}`
        const unixTimestamp = Math.floor(datetime.getTime() / 1000)

        const currentRole = "developer";
        const content = [
            {
                type: "input_text",
                text: `Content extracted from resource ${resourceId}:\n\n<content>\n${text}\n</content>`
            }
        ]

        const promptObj = {
            sourceid: sourceid,
            createdAtSourceTS: unixTimestamp,
            createdAtSourceDT_UTC: new Date(unixTimestamp * 1000),
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: currentRole,
            content: content,
            status: "completed",
            type: "message",
            includeInSearch: true
        }

        await mongo.upsertPrompt(promptObj); //записываем prompt в базу

        this.addTokensUsage(sourceid, JSON.stringify(content), this.#user.currentModel)

        console.log("EXTRACTED CONTEXT COMMITTED TO DIALOGUE")
    }

    async commitURLContentToDialogue(text, imageBase64, mimetype, imageSize, resourceId) {
        const datetime = new Date();

        const sourceid = otherFunctions.valueToMD5(datetime.toISOString()) + `extracted_content_${resourceId}`
        const unixTimestamp = Math.floor(datetime.getTime() / 1000)

        const currentRole = "developer";
        const content = [
            {
                type: "input_text",
                text: `Content extracted from resource ${resourceId}:\n\n<content>\n${text}\n</content>`
            }
        ]
        let image_input = false;
        /*   if(imageBase64 && mimetype){
               content.push({type:"input_image",image_url: `data:${mimetype};base64,${imageBase64}`,detail:"auto"})
               image_input = true;
           }*/
        const promptObj = {
            sourceid: sourceid,
            createdAtSourceTS: unixTimestamp,
            createdAtSourceDT_UTC: new Date(unixTimestamp * 1000),
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: currentRole,
            content: content,
            status: "completed",
            type: "message",
            includeInSearch: true,
            image_input: image_input,
            image_size_bites: imageSize,
        }

        await mongo.upsertPrompt(promptObj); //записываем prompt в базу

        this.addTokensUsage(sourceid, JSON.stringify(content[0]), this.#user.currentModel)

        console.log("EXTRACTED URL CONTEXT COMMITTED TO DIALOGUE")
    }


    async commitPromptToDialogue(text, requestInstance) {

        const currentRole = "user"

        let promptObj = {
            sourceid: requestInstance.msgId,
            createdAtSourceTS: requestInstance.msgTS,
            createdAtSourceDT_UTC: new Date(requestInstance.msgTS * 1000),
            telegramMsgId: requestInstance.msgIdsFromRequest,
            userid: this.#user.userid,
            chatid: requestInstance.chatId,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: currentRole,
            content: [{ type: "input_text", text: text }],
            status: "completed",
            type: "message",
            includeInSearch: true
        }

        await mongo.upsertPrompt(promptObj); //записываем prompt в базу

        this.addTokensUsage(promptObj.sourceid, JSON.stringify(promptObj.content), this.#user.currentModel) //must be async

        console.log("USER PROMPT")
    };

    async addTokensUsage(sourceid, text, model) {
        const numberOfTokens = await otherFunctions.countTokensLambda(text, model);
        await mongo.addTokensUsage(sourceid, numberOfTokens)
    }

    async dateTimeSystemPromptForDialogue(regime) {

        const datetime = new Date();
        const text = `Current date and time is: ${datetime.toISOString()} (UTC). Use it when applicable`

        return {
            role: "developer",
            content: [{ type: "input_text", text: text }],
            status: "completed",
            type: "message"
        }
    }

    async mcpToolsSystemPromptForDialogue(regime) {

        if (regime !== "chat") {
            return []
        };
        const mcp_tools = Object.values(this.#user?.mcp?.tools || {});
        return mcp_tools;
    };

    async initialSystemPromptForDialogue(regime) {

        let promptText = "";
        if (regime === "chat") {
            promptText = otherFunctions.startDeveloperPrompt(this.#user)
        } else if (regime === "translator") {
            promptText = devPrompts.translator_start_prompt()
        } else if (regime === "texteditor") {
            promptText = devPrompts.texteditor_start_prompt()
        } else {
            promptText = ""
        }

        return {
            role: "developer",
            content: [{ type: "input_text", text: promptText }],
            status: "completed",
            type: "message"
        }
    }


    async commitDevPromptToDialogue(text) {

        const datetime = new Date();

        const sourceid = otherFunctions.valueToMD5(datetime.toISOString())
        const unixTimestamp = Math.floor(datetime.getTime() / 1000)
        let systemObj = {
            sourceid: sourceid,
            createdAtSourceTS: unixTimestamp,
            createdAtSourceDT_UTC: new Date(unixTimestamp * 1000),
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: "developer",
            content: [{
                text: text,
                type: "input_text"
            }],
            status: "completed",
            type: "message",
            includeInSearch: false
        }

        const savedSystem = await mongo.upsertPrompt(systemObj); //записываем prompt в базу

        this.addTokensUsage(systemObj.sourceid, JSON.stringify(systemObj.content), this.#user.currentModel)

        console.log("DEVELOPER MESSAGE")
    };

    async commitMCPToolsToDialogue(responseId, output_index, mcp_tool_item, tgm_msg_id) {

        const { id, server_label, tools } = mcp_tool_item;
        const datetime = new Date();
        const sourceid = `${responseId}_output_index_${output_index}`;

        const unixTimestamp = Math.floor(datetime.getTime() / 1000)
        let systemObj = {
            sourceid: sourceid,
            createdAtSourceTS: unixTimestamp,
            createdAtSourceDT_UTC: new Date(unixTimestamp * 1000),
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: "assistant",
            responseId: responseId,
            mcp_tool_call_id: id,
            mcp_tools: tools,
            mcp_server_label: server_label,
            mcp_error: null,
            status: "completed",
            type: "mcp_list_tools",
            includeInSearch: false,
            telegramMsgId: [tgm_msg_id]
        }

        const savedSystem = await mongo.upsertPrompt(systemObj); //записываем prompt в базу

        this.addTokensUsage(systemObj.sourceid, JSON.stringify(systemObj.mcp_tools), this.#user.currentModel)

        console.log("MCP TOOLS LIST COMMITED")
    };

    async commitMCPApprovalRequestToDialogue(responseId, output_index, request_item, tgm_msg_id) {

        const { id, server_label, name, type } = request_item;
        const call_arguments = request_item.arguments;
        const datetime = new Date();
        const sourceid = `${responseId}_output_index_${output_index}_request`;

        const unixTimestamp = Math.floor(datetime.getTime() / 1000)
        let systemObj = {
            sourceid: sourceid,
            createdAtSourceTS: unixTimestamp,
            createdAtSourceDT_UTC: new Date(unixTimestamp * 1000),
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: "assistant",
            responseId: responseId,
            mcp_approval_request_id: id,
            mcp_call_name: name,
            mcp_call_arguments: call_arguments,
            mcp_server_label: server_label,
            status: "completed",
            type: "mcp_approval_request",
            includeInSearch: false,
            telegramMsgId: [tgm_msg_id]
        }

        const savedSystem = await mongo.upsertPrompt(systemObj); //записываем prompt в базу

        this.addTokensUsage(systemObj.sourceid, JSON.stringify(systemObj.mcp_call_arguments), this.#user.currentModel)

        console.log("MCP APPROVAL REQUEST COMMITED")
    };

    async commitMCPCallToDialogue(responseId, output_index, call_item, tgm_msg_id) {

        const { id, server_label, name, error, output } = call_item;
        const call_arguments = call_item.arguments;
        const datetime = new Date();
        const sourceid = `${responseId}_output_index_${output_index}_call`;

        const unixTimestamp = Math.floor(datetime.getTime() / 1000)
        let systemObj = {
            sourceid: sourceid,
            createdAtSourceTS: unixTimestamp,
            createdAtSourceDT_UTC: new Date(unixTimestamp * 1000),
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: "assistant",
            responseId: responseId,
            mcp_call_id: id,
            mcp_call_name: name,
            mcp_call_arguments: call_arguments,
            mcp_call_error: error,
            mcp_call_output: output,
            mcp_server_label: server_label,
            status: "completed",
            type: "mcp_call",
            includeInSearch: false,
            telegramMsgId: [tgm_msg_id]
        }

        const savedSystem = await mongo.upsertPrompt(systemObj); //записываем prompt в базу

        this.addTokensUsage(systemObj.sourceid, JSON.stringify(systemObj.mcp_call_output), this.#user.currentModel)

        console.log("MCP CALL COMMITED")
    };

    async commitReasoningToDialogue(responseId, output_index, reasoning_item) {

        const { id, encrypted_content, summary } = reasoning_item;
        const datetime = new Date();
        const sourceid = `${responseId}_output_index_${output_index}_reasoning`;

        const unixTimestamp = Math.floor(datetime.getTime() / 1000)
        let systemObj = {
            sourceid: sourceid,
            createdAtSourceTS: unixTimestamp,
            createdAtSourceDT_UTC: new Date(unixTimestamp * 1000),
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: "assistant",
            status: "completed",
            responseId: responseId,
            reasoning_id: id,
            reasoning_encrypted_content: encrypted_content,
            reasoning_summary: summary,
            type: "reasoning",
            includeInSearch: false
        }

        const savedSystem = await mongo.upsertPrompt(systemObj); //записываем prompt в базу

        console.log("REASONING CALL COMMITED")
    };

    async commitMCPApprovalResponseToDialogue(response_item) {

        const { request_id, server_label, approve, reason, responseId, output_index, tgm_msg_id } = response_item;
        const datetime = new Date();
        const sourceid = `${responseId}_output_index_${output_index}_response`;
        const response_id = "mcpa_" + otherFunctions.valueToMD5(datetime.toISOString()); //response_id is optional, so we set it to null if not present

        const unixTimestamp = Math.floor(datetime.getTime() / 1000)
        let systemObj = {
            sourceid: sourceid,
            createdAtSourceTS: unixTimestamp,
            createdAtSourceDT_UTC: new Date(unixTimestamp * 1000),
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: "user",
            responseId: responseId,
            mcp_approval_response_id: response_id,
            mcp_approval_request_id: request_id,
            mcp_call_approve: approve,
            mcp_call_user_response_reason: reason,
            mcp_server_label: server_label,
            type: "mcp_approval_response",
            includeInSearch: false,
            telegramMsgId: [tgm_msg_id]
        }

        const savedSystem = await mongo.upsertPrompt(systemObj); //записываем prompt в базу

        this.addTokensUsage(systemObj.sourceid, JSON.stringify(systemObj.mcp_call_user_response_reason || ""), this.#user.currentModel)

        console.log("MCP APPROVAL REQUEST COMMITED")
    };

    async commitCodeInterpreterToDialogue(responseId, output_index, code_int_item, tgm_msg_id) {

        const { id, code, container_id, outputs = [] } = code_int_item;

        const datetime = new Date();
        const sourceid = `${responseId}_output_index_${output_index}_code_interpreter`;

        const unixTimestamp = Math.floor(datetime.getTime() / 1000)
        let systemObj = {
            sourceid: sourceid,
            createdAtSourceTS: unixTimestamp,
            createdAtSourceDT_UTC: new Date(unixTimestamp * 1000),
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: "assistant",
            responseId: responseId,
            code_id: id,
            code: code,
            code_container_id: container_id,
            outputs: outputs,
            status: "completed",
            type: "code_interpreter_call",
            includeInSearch: false,
            telegramMsgId: [tgm_msg_id]
        }

        const savedSystem = await mongo.upsertPrompt(systemObj); //записываем prompt в базу

        this.addTokensUsage(systemObj.sourceid, JSON.stringify(systemObj.code) + JSON.stringify(systemObj.outputs), this.#user.currentModel)

        console.log("CODE INTERPRETER OUTPUT COMMITED")
    };

    async commitCodeInterpreterOutputToDialogue(responseId, output_index, code_int_item, tgm_msg_id) {

        const datetime = new Date();
        const sourceid = `${responseId}_output_index_${output_index}_code_interpreter_output`;
        const unixTimestamp = Math.floor(datetime.getTime() / 1000)
        const { id, code, container_id, outputs = [] } = code_int_item;

        const text = `code_interpreter_call returned the following output: 
        Code: 
        ${code}

        Container ID: ${container_id}
        
        Output:
        ${JSON.stringify(outputs, null, 2)}
        `

        let systemObj = {
            sourceid: sourceid,
            createdAtSourceTS: unixTimestamp,
            createdAtSourceDT_UTC: new Date(unixTimestamp * 1000),
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: "developer",
            code_id: id,
            code: code,
            code_container_id: container_id,
            outputs: outputs,
            content: [{
                text: text,
                type: "input_text"
            }],
            status: "completed",
            type: "message",
            includeInSearch: false,
            telegramMsgId: [tgm_msg_id]
        }

        await mongo.upsertPrompt(systemObj); //записываем prompt в базу

        this.addTokensUsage(systemObj.sourceid, JSON.stringify(systemObj.content), this.#user.currentModel)

        console.log("CODE INTERPRETER DEVELOPER MESSAGE")
    };

    async sendUnsuccessFileMsg(fileSystemObj) {

        const MsgText = `❌ Файл <code>${fileSystemObj.fileName}</code> не может быть добавлен в наш диалог. К сожалению, файлы с расширением <code>${fileSystemObj.fileExtention}</code> не обрабатываются.`

        const resultTGM = await this.#replyMsg.simpleSendNewMessage(MsgText, null, "html", null)
    }

    async checkPDFLimit(pdf_size_bites, pdf_pages) {

        if (this.#metaObject.pdf_input_limit_exceeded) {
            return false
        }

        const currentPdfSize = this.#metaObject.pdf_input_bites + pdf_size_bites;
        const currentPdfCount = this.#metaObject.pdf_input_pages + pdf_pages;

        const pdf_size_limit = modelConfig[this.#user.currentModel]?.pdf_input_limit_bites ?? 1024 * 1024
        const pdf_count_limit = modelConfig[this.#user.currentModel]?.pdf_input_limit_pages ?? 5

        if (currentPdfSize > pdf_size_limit || currentPdfCount > pdf_count_limit) {
            await this.metaPdfInputLimitExceeded()
            return false
        } else {
            return true
        }
    }

    async checkImageLimitAndNotify(image_size_bites, image_count) {

        const currentImageSize = this.#metaObject.image_input_bites + image_size_bites;
        const currentImageCount = this.#metaObject.image_input_count + image_count;

        const image_size_limit = modelConfig[this.#user.currentModel]?.image_input_limit_bites ?? 1024 * 1024
        const image_count_limit = modelConfig[this.#user.currentModel]?.image_input_limit_count ?? 5

        if (currentImageSize > image_size_limit || currentImageCount > image_count_limit) {

            if (!this.#metaObject.image_input_limit_exceeded) {
                await this.metaImageInputLimitExceeded()
                const msgText = otherFunctions.getLocalizedPhrase(`too_many_messages`, this.#user.language)
                this.#replyMsg.simpleSendNewMessage(msgText, null, "html", null)
            }
        }
    }

    async commitImageToDialogue(descriptionJson, image, index = 1, tgm_msg_id) {

        const content = [];
        let image_input = null;
        let total_byte_size = 0;
        if (descriptionJson) {
            content.push({ type: "input_text", text: JSON.stringify(descriptionJson) });
        }

        const { url, base64, sizeBytes, mimetype, error } = image;

        if (base64) {
            content.push({ type: "input_image", image_url: `data:${mimetype};base64,${base64}`, detail: "auto" })
            image_input = true;
            total_byte_size += sizeBytes;
        } else if (url) {
            content.push({ type: "input_image", image_url: url, detail: "auto" })
            image_input = true;
            total_byte_size += sizeBytes;
        } else {
            content.push({ type: "input_text", text: error || "Image data should be here, but it was not received." });
            image_input = false;
        }

        await this.checkImageLimitAndNotify(total_byte_size, 1)

        const datetime = new Date();
        const sourceid = otherFunctions.valueToMD5(datetime.toISOString()) + "_" + index + "_" + "image_url"
        const unixTimestamp = Math.floor(datetime.getTime() / 1000)

        let promptObj = {
            sourceid: sourceid,
            createdAtSourceTS: unixTimestamp,
            createdAtSourceDT_UTC: new Date(unixTimestamp * 1000),
            fileId: this.#requestMsg.msgId,
            fileName: this.#requestMsg.fileName,
            fileUrl: url,
            fileCaption: this.#requestMsg.fileCaption,
            fileExtention: this.#requestMsg.fileExtention,
            fileMimeType: this.#requestMsg.fileMimeType,
            telegramMsgId: this.#requestMsg.msgIdsFromRequest,
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: "user",
            content: content,
            status: "completed",
            type: "message",
            includeInSearch: true,
            image_size_bites: total_byte_size,
            image_input: image_input,
            telegramMsgId: tgm_msg_id ? [tgm_msg_id] : null
        }

        await mongo.upsertPrompt(promptObj); //записываем prompt в базу

        image_input && await this.metaIncrementImageInput(total_byte_size, 1)
        const text_content = content.filter(item => item.type === "input_text");
        this.addTokensUsage(promptObj.sourceid, JSON.stringify(text_content), this.#user.currentModel)
        console.log("USER IMAGE")
    }




    async commitOAIImageToDialogue(responseId, output_index, image_item, tgm_msg_id) {

        const { id, result } = image_item;

        const datetime = new Date();
        const sourceid = `${responseId}_output_index_${output_index}_image`;
        const unixTimestamp = Math.floor(datetime.getTime() / 1000);

        let promptObj = {
            sourceid: sourceid,
            createdAtSourceTS: unixTimestamp,
            createdAtSourceDT_UTC: new Date(unixTimestamp * 1000),
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: "assistant",
            image_id: id,
            image_result_base64: result,
            status: "completed",
            type: "image_generation_call",
            telegramMsgId: [tgm_msg_id],
        }

        await mongo.upsertPrompt(promptObj); //записываем prompt в базу

        console.log("IMAGE GENERATION COMMITED")
    }


    async commitExtractedResourceToTempStorage(type, resourceId, resourceData) {



    }

    async commitResourceToTempStorage(type, resourceId) {

        const object = {
            userid: this.#userid,
            agent: this.#user.currentRegime,
            resourceType: type,
            resourceId: resourceId,
            extracted: false,
            embeddedInDialogue: false,
            createdAt: new Date()
        };

        const urlExpiration = new Date(Date.now() + (global.appsettings?.telegram_options?.url_expiration_ms || 3600000)); // Default to 1 hour if not set
        if (type === "url" || type === "github_resource") {
            object.resourceData = {}
        } else if (type === "document" || type === "media" || type === "image") {

            object.resourceData = {
                fileName: this.#requestMsg.fileName,
                mimeType: this.#requestMsg.fileMimeType,
                fileSize: this.#requestMsg.fileSize,
                fileExtention: this.#requestMsg.fileExtention,
                tgmUrl: this.#requestMsg.fileLink,
                tgmUrlExpiration: urlExpiration
            };
        }

        await mongo.saveResourceToTempStorage(object.userid, object.agent, object.resourceId, object.resourceType, object.extracted, object.embeddedInDialogue, object.createdAt, object.resourceData)
        return { fileName: object?.resourceData?.fileName };
    }

    async commitResourceToDialogue(resourceId, fileName) {

        const sourceid = String(resourceId) + "_" + "resource_uploaded";
        const obj = {
            resourceId: resourceId,
            fileName: fileName,
        };

        const placeholders = [{ key: "[fileInfo]", filler: JSON.stringify(obj, null, 4) }]
        const text = otherFunctions.getLocalizedPhrase("file_upload_success", this.#requestMsg.user.language_code, placeholders)

        const content = [{ type: "input_text", text: text }]
        const createdTS = Date.now();

        let fileSystemObj = {
            sourceid: sourceid,
            createdAtSourceTS: createdTS,
            createdAtSourceDT_UTC: new Date(),
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: 'user',
            content: content,
            status: "completed",
            type: "message",
            includeInSearch: true
        };

        await mongo.upsertPrompt(fileSystemObj); //записываем prompt в базу
        this.addTokensUsage(fileSystemObj.sourceid, JSON.stringify(fileSystemObj.content), this.#user.currentModel);

        console.log("FILE RESOURCE added to dialogue")
        return fileSystemObj
    }

    async commitPDFToDialogue(resourceId, base64, sizePages) {

        const sourceid = String(this.#requestMsg.msgId) + "_" + "PDF_uploaded";

        const content = [
            { type: "input_text", text: `The following PDF file is uploaded by user under resourceId ${resourceId}` },
            {
                type: "input_file",
                filename: this.#requestMsg.fileName,
                file_data: `data:application/pdf;base64,${base64}`
            }
        ];

        const createdTS = Date.now();

        let fileSystemObj = {
            sourceid: sourceid,
            createdAtSourceTS: createdTS,
            createdAtSourceDT_UTC: new Date(),
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: 'user',
            content: content,
            status: "completed",
            type: "message",
            includeInSearch: true
        };

        await mongo.upsertPrompt(fileSystemObj); //записываем prompt в базу
        await this.metaIncrementPdfInput(this.#requestMsg.fileSize, sizePages)

        this.addTokensUsage(fileSystemObj.sourceid, JSON.stringify(fileSystemObj.content[0]), this.#user.currentModel)

        console.log("PDF UPLOAD added to dialogue")
        return fileSystemObj;
    };

    async commitPDFByIdToDialogue(resourceId, fileId, sizePages,expires_at) {

        const sourceid = String(this.#requestMsg.msgId) + "_" + "PDF_uploaded";

        const content = [
            { type: "input_text", text: `The following PDF file is uploaded by user under resourceId ${resourceId}` },
            {
                type: "input_file",
                file_id: fileId
            }
        ];

        const createdTS = Date.now();

        let fileSystemObj = {
            sourceid: sourceid,
            createdAtSourceTS: createdTS,
            createdAtSourceDT_UTC: new Date(),
            expires_at:expires_at,
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: 'user',
            content: content,
            status: "completed",
            type: "message",
            includeInSearch: true
        };

        await mongo.upsertPrompt(fileSystemObj); //записываем prompt в базу
        await this.metaIncrementPdfInput(this.#requestMsg.fileSize, sizePages)

        this.addTokensUsage(fileSystemObj.sourceid, JSON.stringify(fileSystemObj.content), this.#user.currentModel)

        console.log("PDF UPLOAD added to dialogue")
        return fileSystemObj;
    };

    async commitFileToDialogue(url, base64, sizePages) {

        const fileid = this.#requestMsg.msgId
        const sourceid = String(this.#requestMsg.msgId) + "_" + "file_uploaded"
        const obj = {
            fileid: fileid,
            filename: this.#requestMsg.fileName,
            download_url: url
        };

        const placeholders = [{ key: "[fileInfo]", filler: JSON.stringify(obj, null, 4) }]
        const text = otherFunctions.getLocalizedPhrase("file_upload_success", this.#requestMsg.user.language_code, placeholders)

        const content = [{ type: "input_text", text: text }]

        let pdf_input = false;
        if (base64 && await this.checkPDFLimit(this.#requestMsg.fileSize, sizePages)) {

            content.push({ type: "input_file", filename: this.#requestMsg.fileName, file_data: `data:application/pdf;base64,${base64}` })
            pdf_input = true;
        }

        let fileSystemObj = {
            sourceid: sourceid,
            createdAtSourceTS: this.#requestMsg.msgTS,
            createdAtSourceDT_UTC: new Date(this.#requestMsg.msgTS * 1000),
            fileId: fileid,
            fileName: this.#requestMsg.fileName,
            fileUrl: url,
            fileCaption: this.#requestMsg.fileCaption,
            fileExtention: this.#requestMsg.fileExtention,
            fileMimeType: this.#requestMsg.fileMimeType,
            fileSizeBytes: this.#requestMsg.fileSize,
            pdfSizePages: sizePages,
            pdf_input: pdf_input,
            fileDurationSeconds: this.#requestMsg.duration_seconds,
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: 'user',
            content: content,
            status: "completed",
            type: "message",
            includeInSearch: true
        }

        await mongo.upsertPrompt(fileSystemObj); //записываем prompt в базу
        pdf_input && await this.metaIncrementPdfInput(this.#requestMsg.fileSize, sizePages)

        this.addTokensUsage(fileSystemObj.sourceid, JSON.stringify(fileSystemObj.content), this.#user.currentModel)

        console.log("FILE UPLOAD added to dialogue")
        return fileSystemObj

    };


    async commitFunctionCallToDialogue(functionCall) {

        const userInstance = this.#user

        let functionObject = {
            sourceid: functionCall.sourceid,
            responseId: functionCall.responseId,
            output_item_index: functionCall.output_item_index,
            userFirstName: userInstance.user_first_name,
            userLastName: userInstance.user_last_name,
            userid: userInstance.userid,
            regime: userInstance.currentRegime,
            tool_call_id: functionCall.tool_call_id,
            function_name: functionCall.function_name,
            function_arguments: functionCall.function_arguments,
            status: functionCall.status,
            type: functionCall.type,
            functionFriendlyName: functionCall.tool_config?.friendly_name,
            createdAtSourceDT_UTC: new Date(),
            createdAtSourceTS: Math.ceil(Number(new Date()) / 1000),
            includeInSearch: true
        };

        await mongo.insertFunctionObject(functionObject)

        this.addTokensUsage(functionObject.sourceid, JSON.stringify({
            type: functionObject.type,
            call_id: functionObject.tool_call_id,
            name: functionObject.function_name,
            arguments: functionObject.function_arguments
        }), this.#user.currentModel)

        console.log("FUNCTION CALL COMMITED")

    }


    async preCommitFunctionReply(functionReply) {

        const userInstance = this.#user

        let functionObject = {
            sourceid: functionReply.sourceid,
            userFirstName: userInstance.user_first_name,
            userLastName: userInstance.user_last_name,
            userid: userInstance.userid,
            regime: userInstance.currentRegime,
            content: "result is pending ...",
            tool_call_id: functionReply.tool_call_id,
            function_name: functionReply.function_name,
            output_item_index: functionReply.output_item_index,
            status: functionReply.status,
            type: functionReply.type,
            duration: 0,
            success: 0,
            functionFriendlyName: functionReply.tool_config?.friendly_name,
            createdAtSourceDT_UTC: new Date(),
            createdAtSourceTS: Math.ceil(Number(new Date()) / 1000),
            includeInSearch: true
        };

        await mongo.insertFunctionObject(functionObject)

        console.log("TOOL REPLY PRECOMMITED")
    }

    async updateCommitToolReply(result) {


        await mongo.updateToolCallResult(result)

        this.addTokensUsage(result.sourceid, JSON.stringify(result.content), this.#user.currentModel)

        console.log("TOOL REPLY UPDATED")
    }

    async commitCompletionDialogue(completionObject) {
        await mongo.upsertCompletionPromise(completionObject);

        this.addTokensUsage(completionObject.sourceid, JSON.stringify(completionObject.content), this.#user.currentModel)

        console.log("COMPLETION MESSAGE COMMIT")
        return completionObject.output_item_index
    }

    async finalizeTokenUsage(model, tokenUsage) {

        if (tokenUsage) {

            this.metaUpdateTotalTokens(tokenUsage?.total_tokens)

            mongo.insertTokenUsage({
                userInstance: this.#user,
                prompt_tokens: tokenUsage.input_tokens,
                completion_tokens: tokenUsage.output_tokens,
                model: model
            })

            mongo.insertCreditUsage({
                userInstance: this.#user,
                creditType: "text_tokens",
                creditSubType: "input",
                usage: tokenUsage.input_tokens,
                details: { place_in_code: "finalizeTokenUsage" }
            })

            mongo.insertCreditUsage({
                userInstance: this.#user,
                creditType: "text_tokens",
                creditSubType: "output",
                usage: tokenUsage.output_tokens,
                details: { place_in_code: "finalizeTokenUsage" }
            })
        }
    }

};

module.exports = Dialogue;