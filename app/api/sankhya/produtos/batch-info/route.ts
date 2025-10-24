
import { NextResponse } from 'next/server';
import { buscarPrecoProduto, consultarEstoqueProduto } from '@/lib/produtos-service';

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { codigos } = await request.json();

    if (!codigos || !Array.isArray(codigos)) {
      return NextResponse.json(
        { error: 'Códigos de produtos são obrigatórios' },
        { status: 400 }
      );
    }

    // Processar em lote com limite (sem delay, mais rápido)
    const limit = Math.min(codigos.length, 20);
    const results: any = {};

    // Processar TUDO em paralelo para máxima velocidade
    const promises = codigos.slice(0, limit).map(async (codProd) => {
      try {
        const [preco, estoque] = await Promise.all([
          buscarPrecoProduto(codProd, 0, true),
          consultarEstoqueProduto(codProd, '', true)
        ]);

        return {
          codProd,
          data: {
            preco: preco || 0,
            estoque: estoque.estoqueTotal || 0
          }
        };
      } catch (error) {
        return {
          codProd,
          data: {
            preco: 0,
            estoque: 0,
            error: true
          }
        };
      }
    });

    // Esperar todos em paralelo
    const settled = await Promise.allSettled(promises);
    settled.forEach((result) => {
      if (result.status === 'fulfilled') {
        results[result.value.codProd] = result.value.data;
      }
    });
    }

    return NextResponse.json(results, {
      headers: {
        'Cache-Control': 'public, max-age=300', // 5 minutos
      },
    });
  } catch (error: any) {
    console.error('Erro ao buscar informações em lote:', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao buscar informações' },
      { status: 500 }
    );
  }
}
