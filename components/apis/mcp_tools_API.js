

const openAIApi = require("./openAI_API.js");
const AvailableTools = require("../objects/AvailableTools.js");

const {McpClient,
    StreamableHTTPClientTransport} = require("../moduleImports.js");

async function getMCPToolsList(userInstance,agent){    

    const input = "Request mcp_list_tools of all mcp in the tools list.";
    const model = appsettings.mcp_options.mcp_tools_model;
    const instructions = null;
    const temperature = 0;

    const availableToolsInstance = new AvailableTools(userInstance);
    const tools = await availableToolsInstance.getMCPToolsForCompletion(agent);
    if (tools.length === 0) return [];
    const tool_choice = "required";
    const output_format = { "type": "text" };
    const truncation = null;

    const response = await openAIApi.responseSync(
        model,
        instructions,
        input,
        temperature,
        tools,
        tool_choice,
        output_format,
        truncation)


    const mcpInitResults = tools
    .filter(tool => tool.server_url)
    .map(tool => (async () => {
        const {server_url,authorization,server_label} = tool;
        try{
            const result = await connectMCP(server_url, authorization);
            return {mcp_session_id:result?.transport?.sessionId, server_label};
        } catch(err){
            return {error: err.message, server_label};
        }
        
    })());

    const initResults = await Promise.all(mcpInitResults)
    const { output } = response;
    const toolsList = output.filter(item => item.type === 'mcp_list_tools')
    
    return {tools:toolsList, mcpSessionId: initResults};
};


async function githubMCPCall(name,argumentsObj,auth_token){

    const Github_URL = appsettings.mcp_options.github_endpoint;

    const mcp_client = global.mcptools?.github?.client || await connectMCP(Github_URL, auth_token);

    const result = await mcp_client.callTool({
        name:name,
        arguments:argumentsObj
    });

    if(result.isError){
        return {call_name: name, arguments: argumentsObj, error: result.error};
    } else {
        return {call_name: name, arguments: argumentsObj, content: result.content};
    }
}


async function connectMCP(URL, auth_token){

    const McpClientClass = await McpClient();
    const StreamableHTTPClientTransportClass = await StreamableHTTPClientTransport();

    const requestInit = {};
    if (auth_token) {
        requestInit.headers = {
            Authorization: `Bearer ${auth_token}`,
            'User-Agent': 'Bruno bot/1.0.0',
        };
    };

    const transport = new StreamableHTTPClientTransportClass( URL,{
        requestInit: requestInit,
        reconnectionOptions: {
            initialReconnectionDelay: 1000,
            maxReconnectionDelay: 30000,
            reconnectionDelayGrowFactor: 1.5,
            maxRetries: 2
        }
    }
    );

    const client = new McpClientClass({
        name:"Bruno bot",
        version: '1.0.0',
    }, {
         capabilities: {
         }
       }
    );
    await client.connect(transport)

    return client;
}

module.exports = {
    getMCPToolsList,
    githubMCPCall,
    connectMCP
};

// Expose internal functions for integration testing only
if (process.env.NODE_ENV === 'test') {
    module.exports._test = {
    getMCPToolsList,
    githubMCPCall
    };
}

