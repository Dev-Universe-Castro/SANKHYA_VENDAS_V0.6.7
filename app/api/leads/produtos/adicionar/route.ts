
import { NextResponse } from 'next/server';

const URL_SAVE_SERVICO = "https://api.sandbox.sankhya.com.br/gateway/v1/mge/service.sbr?serviceName=DatasetSP.save&outputType=json";
const URL_CONSULTA = "https://api.sandbox.sankhya.com.br/gateway/v1/mge/service.sbr?serviceName=CRUDServiceProvider.loadRecords&outputType=json";
const ENDPOINT_LOGIN = "https://api.sandbox.sankhya.com.br/login";

const LOGIN_HEADERS = {
  'token': process.env.SANKHYA_TOKEN || "",
  'appkey': process.env.SANKHYA_APPKEY || "",
  'username': process.env.SANKHYA_USERNAME || "",
  'password': process.env.SANKHYA_PASSWORD || ""
};

let cachedToken: string | null = null;

async function obterToken(): Promise<string> {
  if (cachedToken) {
    return cachedToken;
  }

  const axios = require('axios');
  const resposta = await axios.post(ENDPOINT_LOGIN, {}, {
    headers: LOGIN_HEADERS,
    timeout: 10000
  });

  const token = resposta.data.bearerToken || resposta.data.token;
  if (!token) {
    throw new Error("Token não encontrado na resposta de login.");
  }

  cachedToken = token;
  return token;
}

async function fazerRequisicaoAutenticada(fullUrl: string, method = 'POST', data = {}) {
  const token = await obterToken();
  const axios = require('axios');

  const config = {
    method: method.toLowerCase(),
    url: fullUrl,
    data: data,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };

  const resposta = await axios(config);
  return resposta.data;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log('📥 Dados recebidos para adicionar produto:', body);
    
    let { CODLEAD, CODPROD, DESCRPROD, QUANTIDADE, VLRUNIT, VLRTOTAL } = body;

    if (!CODLEAD || !CODPROD || !DESCRPROD || !QUANTIDADE) {
      console.error('❌ Dados obrigatórios faltando');
      return NextResponse.json(
        { error: 'CODLEAD, CODPROD, DESCRPROD e QUANTIDADE são obrigatórios' },
        { status: 400 }
      );
    }

    // Se não tem preço, buscar da API
    if (!VLRUNIT || VLRUNIT === 0) {
      const { buscarPrecoProduto } = await import('@/lib/produtos-service');
      console.log(`🔍 Buscando preço do produto ${CODPROD}...`);
      VLRUNIT = await buscarPrecoProduto(String(CODPROD));
      console.log(`💰 Preço encontrado: ${VLRUNIT}`);
    }

    // Recalcular total
    VLRTOTAL = QUANTIDADE * VLRUNIT;

    // Formatar data no padrão DD/MM/YYYY
    const dataAtual = new Date();
    const dia = String(dataAtual.getDate()).padStart(2, '0');
    const mes = String(dataAtual.getMonth() + 1).padStart(2, '0');
    const ano = dataAtual.getFullYear();
    const dataFormatada = `${dia}/${mes}/${ano}`;

    // 1. Adicionar produto ao lead
    const PAYLOAD_PRODUTO = {
      "serviceName": "DatasetSP.save",
      "requestBody": {
        "entityName": "AD_ADLEADSPRODUTOS",
        "standAlone": false,
        "fields": ["CODLEAD", "CODPROD", "DESCRPROD", "QUANTIDADE", "VLRUNIT", "VLRTOTAL", "ATIVO", "DATA_INCLUSAO"],
        "records": [{
          "values": {
            "0": String(CODLEAD),
            "1": String(CODPROD),
            "2": String(DESCRPROD),
            "3": String(QUANTIDADE),
            "4": String(VLRUNIT),
            "5": String(VLRTOTAL),
            "6": "S",
            "7": dataFormatada
          }
        }]
      }
    };

    console.log('📝 Adicionando produto:', JSON.stringify(PAYLOAD_PRODUTO, null, 2));
    const respostaProduto = await fazerRequisicaoAutenticada(URL_SAVE_SERVICO, 'POST', PAYLOAD_PRODUTO);
    console.log('✅ Produto adicionado:', respostaProduto);

    // 2. Recalcular valor total do lead
    const PAYLOAD_CONSULTA = {
      "requestBody": {
        "dataSet": {
          "rootEntity": "AD_ADLEADSPRODUTOS",
          "includePresentationFields": "S",
          "offsetPage": "0",
          "entity": {
            "fieldset": {
              "list": "VLRTOTAL"
            }
          },
          "criteria": {
            "expression": {
              "$": `CODLEAD = '${CODLEAD}' AND ATIVO = 'S'`
            }
          }
        }
      }
    };

    const responseProdutos = await fazerRequisicaoAutenticada(URL_CONSULTA, 'POST', PAYLOAD_CONSULTA);
    
    let novoValorTotal = 0;
    if (responseProdutos?.responseBody?.entities?.entity) {
      const entities = Array.isArray(responseProdutos.responseBody.entities.entity) 
        ? responseProdutos.responseBody.entities.entity 
        : [responseProdutos.responseBody.entities.entity];
      
      novoValorTotal = entities.reduce((sum: number, e: any) => {
        return sum + Number(e.f0?.$ || 0);
      }, 0);
    }

    console.log('💰 Novo valor total do lead:', novoValorTotal);

    // 3. Atualizar valor total do lead
    const PAYLOAD_LEAD = {
      "serviceName": "DatasetSP.save",
      "requestBody": {
        "entityName": "AD_LEADS",
        "standAlone": false,
        "fields": ["VALOR", "DATA_ATUALIZACAO"],
        "records": [{
          "pk": { CODLEAD: String(CODLEAD) },
          "values": {
            "0": String(novoValorTotal),
            "1": dataFormatada
          }
        }]
      }
    };

    const respostaLead = await fazerRequisicaoAutenticada(URL_SAVE_SERVICO, 'POST', PAYLOAD_LEAD);
    console.log('✅ Lead atualizado com novo valor total');

    return NextResponse.json({ 
      success: true,
      novoValorTotal: novoValorTotal
    });
  } catch (error: any) {
    console.error('❌ Erro ao adicionar produto:', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao adicionar produto' },
      { status: 500 }
    );
  }
}
